/**
 * Capture-test renderer: records ~10 s of mic and system (loopback) audio in parallel using the same
 * StreamCapture code the app uses, prints per-second RMS/peak, and sends 16 kHz PCM to main.
 */
import { StreamCapture, rms, peak } from '../../src/renderer/audio/pcm';
import type { CaptureApi } from './preload';

const ct = (window as unknown as { ct: CaptureApi }).ct;
const SECONDS = 10;
const SR = 16000;

function log(line: string) {
  ct.log(line);
  const el = document.getElementById('log');
  if (el) el.textContent += line + '\n';
}

interface StreamStats {
  name: 'mic' | 'system';
  ok: boolean;
  error?: string;
  track?: string;
  seconds: number;
  rms: number;
  peak: number;
  perSecond: { rms: number; peak: number }[];
}

async function record(name: 'mic' | 'system', getStream: () => Promise<MediaStream>): Promise<StreamStats> {
  const stats: StreamStats = { name, ok: false, seconds: 0, rms: 0, peak: 0, perSecond: [] };
  let stream: MediaStream | undefined;
  const cap = new StreamCapture();
  try {
    stream = await getStream();
    stream.getVideoTracks().forEach((t) => { t.stop(); stream!.removeTrack(t); });
    const tr = stream.getAudioTracks()[0];
    if (!tr) throw new Error('stream has no audio track');
    stats.track = `${tr.label} ${JSON.stringify(tr.getSettings())}`;
    const parts: Float32Array[] = [];
    let total = 0;
    await cap.start(stream, (s) => { parts.push(s); total += s.length; });
    await new Promise((r) => setTimeout(r, SECONDS * 1000 + 300));
    await cap.stop();
    const all = new Float32Array(total);
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    const pcm = all.slice(0, Math.min(all.length, SECONDS * SR));
    for (let i = 0; i + SR <= pcm.length; i += SR) {
      const sec = pcm.subarray(i, i + SR);
      stats.perSecond.push({ rms: rms(sec), peak: peak(sec) });
      log(`${name.padEnd(6)} second ${i / SR + 1}: rms=${rms(sec).toFixed(4)} peak=${peak(sec).toFixed(4)}`);
    }
    Object.assign(stats, { ok: true, seconds: pcm.length / SR, rms: rms(pcm), peak: peak(pcm) });
    await ct.sendPcm(name, pcm, stats);
  } catch (e) {
    stats.error = `${name}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
    log(`ERROR ${stats.error}`);
    await cap.stop().catch(() => undefined);
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
  }
  return stats;
}

async function main() {
  log('Speak into your mic AND play something with sound (e.g. a YouTube video) for the next 10 seconds.');
  let devices: string[] = [];
  try {
    devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
      .map((d) => `${d.kind}: ${d.label || '(no label - permission not yet granted)'} [${d.deviceId.slice(0, 8)}]`);
  } catch (e) {
    log(`ERROR enumerateDevices: ${String(e)}`);
  }
  const results = await Promise.all([
    record('mic', () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })),
    record('system', () => navigator.mediaDevices.getDisplayMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: true })),
  ]);
  // Re-list after permission so labels are filled in.
  try {
    devices = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
      .map((d) => `${d.kind}: ${d.label || '(no label)'}`);
  } catch { /* keep earlier list */ }
  ct.done({ devices, results });
}

main().catch((e) => ct.done({ devices: [], results: [], fatal: String(e) }));
