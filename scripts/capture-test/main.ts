/**
 * Standalone capture diagnostic: `npm run capture-test` on Windows.
 * Records mic + system loopback audio for ~10 s, writes WAVs and one screenshot to ./capture-test-output,
 * prints a summary to stdout and exits (0 = everything worked, 1 = something failed). 60 s watchdog.
 */
import { app, BrowserWindow, desktopCapturer, ipcMain, session } from 'electron';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeWav } from '../../src/renderer/audio/pcm';

const OUT = path.resolve(process.cwd(), 'capture-test-output');
const errors: string[] = [];
const files: string[] = [];
const out = (s: string) => process.stdout.write(s + '\n');

function finish(report: { devices?: string[]; results?: any[]; fatal?: string }) {
  if (report.fatal) errors.push(`renderer fatal: ${report.fatal}`);
  out('\n================ CAPTURE TEST SUMMARY ================');
  out(`Electron ${process.versions.electron}  Chromium ${process.versions.chrome}  ${process.platform} ${process.arch}`);
  out('Devices:');
  (report.devices ?? []).forEach((d) => out(`  ${d}`));
  for (const r of report.results ?? []) {
    if (r.error) errors.push(r.error);
    out(`${r.name}: ${r.ok ? 'OK' : 'FAILED'}  duration=${r.seconds.toFixed(1)}s  rms=${r.rms.toFixed(4)}  peak=${r.peak.toFixed(4)}`);
    if (r.track) out(`  track: ${r.track}`);
    if (r.ok && r.peak < 0.01) out(`  WARNING: ${r.name} is (near) silent - was ${r.name === 'mic' ? 'anyone speaking / mic muted' : 'audio playing'}?`);
  }
  out('Files:');
  for (const f of files) out(`  ${f}  ${statSync(f).size} bytes`);
  out(errors.length ? `Errors (${errors.length}):` : 'Errors: none');
  errors.forEach((e) => out(`  - ${e}`));
  out('======================================================');
  app.exit(errors.length ? 1 : 0);
}

const watchdog = setTimeout(() => {
  errors.push('watchdog: test did not finish within 60 s');
  finish({});
}, 60_000);

ipcMain.on('ct:log', (_e, line: string) => out(line));
ipcMain.handle('ct:pcm', (_e, { name, samples }: { name: string; samples: Float32Array }) => {
  try {
    const f = path.join(OUT, `${name}.wav`);
    writeFileSync(f, Buffer.from(encodeWav(samples, 16000)));
    files.push(f);
  } catch (e) {
    errors.push(`writing ${name}.wav: ${String(e)}`);
  }
});

async function screenshot() {
  try {
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (!srcs[0]) throw new Error('no screen sources');
    const f = path.join(OUT, 'screenshot.png');
    writeFileSync(f, srcs[0].thumbnail.toPNG());
    files.push(f);
    out(`screenshot: ${srcs[0].name} ${JSON.stringify(srcs[0].thumbnail.getSize())}`);
  } catch (e) {
    errors.push(`screenshot: ${String(e)}`);
  }
}

app.whenReady().then(async () => {
  try {
    mkdirSync(OUT, { recursive: true });
    out(`Tutor Copilot capture test - Electron ${process.versions.electron}. Output: ${OUT}`);
    out('Speak into your mic AND play something with sound (e.g. a YouTube video) for the next 10 seconds.');
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media' || perm === 'display-capture'));
    ses.setPermissionCheckHandler((_wc, perm) => perm === 'media' || perm === 'display-capture');
    ses.setDisplayMediaRequestHandler(
      (_req, cb) => {
        desktopCapturer
          .getSources({ types: ['screen'] })
          .then((s) => cb({ video: s[0], audio: 'loopback' }))
          .catch((e) => { errors.push(`display media handler: ${String(e)}`); cb({}); });
      },
      { useSystemPicker: false },
    );
    await screenshot();
    ipcMain.once('ct:done', (_e, report) => { clearTimeout(watchdog); finish(report); });
    const win = new BrowserWindow({
      width: 520, height: 520, show: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    win.webContents.on('render-process-gone', (_e, d) => { errors.push(`renderer gone: ${d.reason}`); finish({}); });
    win.webContents.on('console-message', (e: any) => { if (e?.level === 'error') out(`[renderer console] ${e.message}`); });
    await win.loadFile(path.join(__dirname, 'index.html'));
  } catch (e) {
    errors.push(`startup: ${e instanceof Error ? e.stack : String(e)}`);
    finish({});
  }
});

process.on('uncaughtException', (e) => { errors.push(`uncaught: ${e.stack ?? e}`); finish({}); });
