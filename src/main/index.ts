import { app, BrowserWindow, desktopCapturer, ipcMain, protocol, session, shell } from 'electron';
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
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  await app.whenReady();

  const rendererDir = path.join(__dirname, '..', 'renderer');
  protocol.handle('app', async (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(rendererDir, p));
    if (!file.startsWith(rendererDir + path.sep)) return new Response('forbidden', { status: 403 });
    try {
      const body = await fs.readFile(file);
      return new Response(body, { headers: { 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream' } });
    } catch { return new Response('not found', { status: 404 }); }
  });

  loadEnv([path.join(app.getAppPath(), '.env'), path.join(app.getPath('userData'), '.env')]);
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
    width: 440, height: 760, title: 'Tutor Copilot',
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
  handle('helpme:ask', ({ windowMinutes }) => lesson.helpMe(windowMinutes));
  handle('screenshot:latest', () => screen.latest());
  handle('audio:levels', (l) => { lesson.setLevels(l); });
  handle('transcriber:status', ({ ready, status }) => { lesson.setTranscriberStatus(ready, status); });
  handle('window:setOpacity', (o) => { win?.setOpacity(Math.min(1, Math.max(0.3, o))); });
  handle('window:setAlwaysOnTop', (v) => { win?.setAlwaysOnTop(v); });
  handle('shell:openPath', async (p) => { await shell.openPath(p); });

  app.on('window-all-closed', () => app.quit());
}

main().catch((e) => { console.error(e); app.quit(); });
