import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, protocol, session, shell } from 'electron';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import type { IpcInvoke, IpcInvokeChannel } from '../shared/ipc';
import {
  AnthropicLlmClient, MockLlmClient, createHelpMeService, createReportGenerator,
  createStorage, loadEnv, windowSegments,
} from './services';
import { LessonSession } from './session';
import { createScreenCapture } from './screen';
import type { LlmClient } from '../shared/interfaces';


let win: BrowserWindow | undefined;

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
};

function handle<C extends IpcInvokeChannel>(
  channel: C,
  fn: (arg: IpcInvoke[C]['arg']) => Promise<IpcInvoke[C]['result']> | IpcInvoke[C]['result'],
): void {
  ipcMain.handle(channel, (_ev, arg) => fn(arg as IpcInvoke[C]['arg']));
}

async function main(): Promise<void> {
  // Pin userData so dev and packaged builds (productName differs) share %APPDATA%\tutor-copilot.
  app.setPath('userData', path.join(app.getPath('appData'), 'tutor-copilot'));
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  await app.whenReady();

  const rendererDir = path.join(__dirname, '..', 'renderer');
  // COOP/COEP make the renderer and its workers crossOriginIsolated, so onnxruntime-web can use
  // SharedArrayBuffer threads for Whisper. 'credentialless' still lets the CDN/HF fetches through.
  // Escape hatch: TUTOR_WASM_THREADS=0 drops the headers (single-threaded WASM, as before). Read per request
  // because .env is loaded below, after this handler is registered.
  const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };
  protocol.handle('app', async (req) => {
    const isolationHeaders: Record<string, string> = process.env.TUTOR_WASM_THREADS === '0' ? {} : ISOLATION;
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(rendererDir, p));
    if (!file.startsWith(rendererDir + path.sep)) return new Response('forbidden', { status: 403, headers: isolationHeaders });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { headers: { ...isolationHeaders, 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
    } catch { return new Response('not found', { status: 404, headers: isolationHeaders }); }
  });

  loadEnv([path.join(app.getAppPath(), '.env'), path.join(app.getPath('userData'), '.env'),
    path.join(path.dirname(process.execPath), '.env')]);
  const dataDir = process.env.TUTOR_DATA_DIR || path.join(app.getPath('userData'), 'data');
  const storage = createStorage(dataDir);
  const llm: LlmClient = process.env.TUTOR_MOCK_LLM === '1' ? new MockLlmClient() : new AnthropicLlmClient();
  const helpMe = createHelpMeService(llm);
  const reports = createReportGenerator(llm);
  const settings = await storage.getSettings();
  const screen = createScreenCapture({ enabled: true }); // gated by settings.screenshotsEnabled at start/toggle
  const lesson = new LessonSession({
    storage, helpMe, reports, screen, windowSegments,
    hasApiKey: () => llm.isConfigured(),
  });

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      // Never leave getDisplayMedia hanging: an empty grant makes it reject with a clear error.
      .catch(() => callback({}));
  }, { useSystemPicker: false });
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(permission === 'media' || permission === 'display-capture');
  });

  win = new BrowserWindow({
    width: 520, height: 860, minWidth: 380, minHeight: 600, title: 'Tutor Copilot',
    alwaysOnTop: settings.alwaysOnTop, opacity: settings.opacity,
    backgroundColor: '#14161a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.on('closed', () => { win = undefined; });
  void win.loadURL('app://tutor/index.html');

  lesson.onChange((s) => { if (win && !win.isDestroyed()) win.webContents.send('state:changed', s); });

  handle('app:getState', () => lesson.getState());
  handle('settings:get', () => storage.getSettings());
  const startShots = (s: { screenshotIntervalSec: number }) => screen.start(s.screenshotIntervalSec * 1000, (shot) => {
    win?.webContents.send('screenshot:updated', { capturedAt: shot.capturedAt, width: shot.width, height: shot.height });
  });
  handle('settings:set', async (patch) => {
    const next = { ...(await storage.getSettings()), ...patch };
    await storage.saveSettings(next);
    if (lesson.getState().status === 'running') {
      if (next.screenshotsEnabled) startShots(next); else screen.stop();
    }
    return next;
  });
  handle('students:list', () => storage.listStudents());
  handle('students:update', async ({ studentId, memoryEnabled }) => {
    const st = await storage.getStudent(studentId);
    if (!st) throw new Error(`Unknown student: ${studentId}`);
    const next = { ...st, memoryEnabled };
    await storage.saveStudent(next);
    return next;
  });
  handle('students:create', ({ name }) => storage.createStudent(name));
  handle('lesson:start', async ({ studentId, subject }) => {
    const l = await lesson.start(studentId, subject);
    const s = await storage.getSettings();
    if (s.screenshotsEnabled) startShots(s);
    return l;
  });
  handle('lesson:end', async () => { try { return await lesson.end(); } finally { screen.stop(); } });
  handle('transcript:append', (segs) => lesson.appendTranscript(segs));
  handle('transcript:get', () => lesson.getTranscript());
  handle('helpme:ask', ({ windowMinutes }) => lesson.helpMe(windowMinutes, (partial) => win?.webContents.send('helpme:partial', partial)));
  handle('screenshot:latest', () => screen.latest());
  handle('audio:levels', (l) => { lesson.setLevels(l); });
  handle('transcriber:status', ({ ready, status }) => { lesson.setTranscriberStatus(ready, status); });
  handle('window:setOpacity', (o) => { win?.setOpacity(Math.min(1, Math.max(0.3, o))); });
  handle('window:setAlwaysOnTop', (v) => { win?.setAlwaysOnTop(v); });
  handle('window:setSize', ({ width, height }) => { win?.setSize(Math.round(width), Math.round(height), true); });
  handle('shell:openPath', async (p) => { await shell.openPath(p); });

  // System-wide F9 so Help-me works while Zoom has focus. The window is not raised or focused.
  if (!globalShortcut.register('F9', () => win?.webContents.send('helpme:trigger', undefined))) {
    console.warn('Could not register global F9 shortcut (already in use by another app).');
  }
  app.on('will-quit', () => globalShortcut.unregisterAll());

  app.on('window-all-closed', () => app.quit());
}

main().catch((e) => { console.error(e); app.quit(); });
