import { app, BrowserWindow, desktopCapturer, ipcMain, session, shell } from 'electron';
import * as path from 'node:path';
import type { IpcInvoke, IpcInvokeChannel } from '../shared/ipc';
import {
  AnthropicLlmClient, MockLlmClient, createHelpMeService, createReportGenerator,
  createStorage, loadEnv, windowSegments,
} from './services';
import { LessonSession } from './session';
import { createScreenCapture } from './screen';
import type { LlmClient } from '../shared/interfaces';


let win: BrowserWindow | undefined;

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

  loadEnv([path.join(app.getAppPath(), '.env'), path.join(app.getPath('userData'), '.env')]);
  const dataDir = process.env.TUTOR_DATA_DIR || path.join(app.getPath('userData'), 'data');
  const storage = createStorage(dataDir);
  const llm: LlmClient = process.env.TUTOR_MOCK_LLM === '1' ? new MockLlmClient() : new AnthropicLlmClient();
  const helpMe = createHelpMeService(llm);
  const reports = createReportGenerator(llm);
  const settings = await storage.getSettings();
  const screen = createScreenCapture({ enabled: settings.screenshotsEnabled });
  const lesson = new LessonSession({
    storage, helpMe, reports, screen, windowSegments,
    hasApiKey: () => llm.isConfigured(),
  });

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
    });
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
  void win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  lesson.onChange((s) => { if (win && !win.isDestroyed()) win.webContents.send('state:changed', s); });

  handle('app:getState', () => lesson.getState());
  handle('settings:get', () => storage.getSettings());
  handle('settings:set', async (patch) => {
    const next = { ...(await storage.getSettings()), ...patch };
    await storage.saveSettings(next);
    return next;
  });
  handle('students:list', () => storage.listStudents());
  handle('students:create', ({ name }) => storage.createStudent(name));
  handle('lesson:start', async ({ studentId, subject }) => {
    const l = await lesson.start(studentId, subject);
    const s = await storage.getSettings();
    if (s.screenshotsEnabled) screen.start(s.screenshotIntervalSec * 1000, (shot) => {
      win?.webContents.send('screenshot:updated', { capturedAt: shot.capturedAt, width: shot.width, height: shot.height });
    });
    return l;
  });
  handle('lesson:end', () => lesson.end());
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
