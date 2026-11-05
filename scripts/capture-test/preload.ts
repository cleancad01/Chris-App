/** Capture-test preload: a tiny bridge so the renderer can log and hand PCM to main. */
import { contextBridge, ipcRenderer } from 'electron';

export interface CaptureApi {
  log(line: string): void;
  sendPcm(name: 'mic' | 'system', samples: Float32Array, stats: unknown): Promise<void>;
  done(report: unknown): void;
}

const api: CaptureApi = {
  log: (line) => ipcRenderer.send('ct:log', line),
  // Float32Array survives structured clone over IPC.
  sendPcm: (name, samples, stats) => ipcRenderer.invoke('ct:pcm', { name, samples, stats }),
  done: (report) => ipcRenderer.send('ct:done', report),
};
contextBridge.exposeInMainWorld('ct', api);
