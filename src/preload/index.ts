import { contextBridge, ipcRenderer } from 'electron';
import type { RendererApi } from '../shared/ipc';

const e = process.env;
const mockAudio = e.TUTOR_MOCK_AUDIO === '1';
const transcriber = ((e.TUTOR_TRANSCRIBER as RendererApi['env']['transcriber'] | undefined) ||
  (mockAudio ? 'mock' : e.OPENAI_API_KEY ? 'hosted' : 'local'));

const api: RendererApi = {
  invoke: (channel, arg) => ipcRenderer.invoke(channel, arg),
  on: (channel, listener) => {
    const fn = (_ev: unknown, payload: any) => listener(payload);
    ipcRenderer.on(channel, fn);
    return () => { ipcRenderer.removeListener(channel, fn); };
  },
  env: {
    mockAudio,
    transcriber,
    whisperModel: e.TUTOR_WHISPER_MODEL || 'Xenova/whisper-base.en',
    hostedApiKey: e.OPENAI_API_KEY,
  },
};

contextBridge.exposeInMainWorld('api', api);
