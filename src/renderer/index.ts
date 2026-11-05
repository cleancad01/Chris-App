import { createAudioSources } from './audio';
import { createTranscriber } from './transcriber';
import type { AudioSource, Transcriber } from '../shared/interfaces';
import type { AppState, AudioChunk, Settings, Student, TranscriptSegment } from '../shared/types';
import { $, h } from './ui/dom';
import { TranscriptView } from './ui/transcriptView';
import { HelpPanel } from './ui/helpPanel';

const api = window.api;
const view = new TranscriptView();
const help = new HelpPanel((q) => api.invoke('helpme:ask', q ? { question: q } : {}));

let state: AppState | undefined;
let sources: AudioSource[] = [];
let transcriber: Transcriber | undefined;
let levelTimer: number | undefined;
let statsTimer: number | undefined;
let busy = false;
let pillOverride: string | undefined;

const studentSel = $<HTMLSelectElement>('student');
const subject = $<HTMLInputElement>('subject');
const startEnd = $<HTMLButtonElement>('startEnd');

function showError(msg: string): void {
  const d = h('div', 'err', msg);
  $('errors').append(d);
}

function toast(text: string, openPath?: string): void {
  const t = $('toast');
  t.replaceChildren(h('span', undefined, text));
  if (openPath) {
    const b = h('button', undefined, 'Open');
    b.addEventListener('click', () => void api.invoke('shell:openPath', openPath));
    t.append(b);
  }
  const x = h('button', 'small', 'x');
  x.addEventListener('click', () => { t.hidden = true; });
  t.append(x);
  t.hidden = false;
}

function render(): void {
  if (!state) return;
  const running = state.status === 'running';
  $('warn').hidden = state.hasApiKey;
  startEnd.textContent = running ? 'End lesson' : state.status === 'ending' ? 'Ending...' : 'Start lesson';
  startEnd.classList.toggle('primary', !running);
  startEnd.disabled = busy || state.status === 'ending';
  studentSel.disabled = subject.disabled = memoryChk.disabled = state.status !== 'idle';
  pauseBtn.hidden = !running;
  pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  const pill = $('pill');
  pill.textContent = (running && paused) ? 'Paused' : pillOverride ?? (state.status === 'idle' ? 'Idle' : state.transcriberStatus);
  pill.classList.toggle('live', running && state.transcriberReady);
  help.setEnabled(running);
  historyBtn.hidden = state.status !== 'idle';
  if (state.status !== 'idle') historyPanel.hidden = true;
  $('mTutor').style.width = `${Math.min(100, state.audioLevels.tutor * 300)}%`;
  $('mStudent').style.width = `${Math.min(100, state.audioLevels.student * 300)}%`;
}

let paused = false;
const pauseBtn = $<HTMLButtonElement>('pauseBtn');
pauseBtn.addEventListener('click', () => { paused = !paused; render(); });

const memoryChk = $<HTMLInputElement>('memory');
let studentList: Student[] = [];
function syncMemory(): void {
  const s = studentList.find((x) => x.id === studentSel.value);
  memoryChk.checked = s?.memoryEnabled !== false;
}
studentSel.addEventListener('change', syncMemory);
memoryChk.addEventListener('change', async () => {
  const studentId = studentSel.value;
  if (!studentId) return;
  try {
    await api.invoke('students:update', { studentId, memoryEnabled: memoryChk.checked });
    await loadStudents(studentId);
  } catch (e) { showError(`Could not update student: ${(e as Error).message}`); syncMemory(); }
});

async function loadStudents(select?: string): Promise<void> {
  const list = await api.invoke('students:list', undefined);
  studentList = list;
  studentSel.replaceChildren(...list.map((s) => { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; return o; }));
  if (select) studentSel.value = select;
  syncMemory();
}

// Electron does not support window.prompt(), so use an inline dialog.
const nameInput = $('newStudentName') as HTMLInputElement;
$('newStudent').addEventListener('click', () => {
  nameInput.value = '';
  $('newStudentModal').hidden = false;
  nameInput.focus();
});
$('newStudentCancel').addEventListener('click', () => { $('newStudentModal').hidden = true; });
async function createStudent(): Promise<void> {
  const name = nameInput.value.trim();
  if (!name) return;
  $('newStudentModal').hidden = true;
  try {
    const s = await api.invoke('students:create', { name });
    await loadStudents(s.id);
  } catch (e) { showError(`Could not create student: ${(e as Error).message}`); }
}
$('newStudentOk').addEventListener('click', () => void createStudent());
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') void createStudent(); });

function setStatus(ready: boolean, status: string): void {
  pillOverride = undefined;
  void api.invoke('transcriber:status', { ready, status });
}

async function beginLesson(): Promise<void> {
  const studentId = studentSel.value;
  if (!studentId) { showError('Pick or create a student first.'); return; }
  busy = true; render();
  try {
    $('errors').replaceChildren();
    view.clear(); help.reset(); paused = false;
    await api.invoke('lesson:start', { studentId, subject: subject.value.trim() || undefined });
    const s = await api.invoke('settings:get', undefined);
    const { tutor, student } = createAudioSources({ mock: api.env.mockAudio });
    const tr = createTranscriber(api.env.transcriber, { model: api.env.whisperModel || s.whisperModel, hostedApiKey: api.env.hostedApiKey });
    transcriber = tr;
    await tr.init((p) => {
      pillOverride = p.percent !== undefined ? `${p.status} ${Math.round(p.percent)}%` : p.status;
      render();
    });
    setStatus(true, 'Listening');
    const onChunk = async (chunk: AudioChunk): Promise<void> => {
      // Trailing chunks can arrive after End lesson (sources flush while stopping): ignore them quietly.
      if (paused || transcriber !== tr) return;
      try {
        const segs: TranscriptSegment[] = await tr.transcribe(chunk);
        if (!segs.length || transcriber !== tr) return;
        view.add(segs);
        await api.invoke('transcript:append', segs);
      } catch (e) {
        if (transcriber === tr) showError(`Transcription error: ${(e as Error).message}`);
      }
    };
    sources = [];
    for (const [src, label] of [[tutor, 'Microphone'], [student, 'System audio']] as const) {
      try { await src.start((c) => void onChunk(c)); sources.push(src); }
      catch (e) { showError(`${label} unavailable: ${(e as Error).message}`); }
    }
    if (!sources.length) showError('No audio sources could be started.');
    levelTimer = window.setInterval(() => {
      const lv = { tutor: tutor.getLevel(), student: student.getLevel() };
      void api.invoke('audio:levels', lv);
    }, 500);
    // Backlog indicator: only LocalWhisperTranscriber has getStats() (not part of the Transcriber interface).
    if (typeof (tr as any).getStats === 'function') { // eslint-disable-line @typescript-eslint/no-explicit-any
      const getStats = () => (tr as unknown as { getStats(): { pending: number; dropped: number; lastLatencyMs: number } }).getStats();
      let lastDropped = 0;
      statsTimer = window.setInterval(() => {
        if (transcriber !== tr || state?.status !== 'running') return;
        const st = getStats();
        const prev = pillOverride;
        if (st.dropped > lastDropped) pillOverride = `Listening (dropped ${st.dropped} chunk${st.dropped === 1 ? '' : 's'})`;
        else if (st.pending >= 2) pillOverride = `Listening (behind ~${Math.max(1, Math.round(st.lastLatencyMs / 1000))}s)`;
        else pillOverride = undefined; // falls back to state.transcriberStatus ("Listening")
        lastDropped = st.dropped;
        if (pillOverride !== prev) render();
      }, 2000);
    }
  } catch (e) {
    showError(`Could not start lesson: ${(e as Error).message}`);
  } finally { busy = false; render(); }
}

async function endLesson(): Promise<void> {
  paused = false;
  busy = true; render();
  $('errors').replaceChildren();
  if (levelTimer) clearInterval(levelTimer);
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = undefined;
  await Promise.all(sources.map((s) => s.stop().catch(() => undefined)));
  sources = [];
  const tr = transcriber;
  transcriber = undefined; // detach first so in-flight chunks are ignored, then dispose
  try { await tr?.dispose(); } catch { /* ignore */ }
  try {
    pillOverride = 'Generating report...'; render();
    const r = await api.invoke('lesson:end', undefined);
    toast(`Report saved: ${r.reportPath}`, r.reportPath);
    void refreshHistory();
  } catch (e) {
    showError(`Could not end lesson: ${(e as Error).message}`);
  } finally { pillOverride = undefined; busy = false; render(); }
}

startEnd.addEventListener('click', () => {
  if (state?.status === 'running') void endLesson();
  else if (state?.status === 'idle') $('consent').hidden = false;
});
$('consentCancel').addEventListener('click', () => { $('consent').hidden = true; });
$('consentOk').addEventListener('click', () => { $('consent').hidden = true; void beginLesson(); });

// Lesson history
const historyPanel = $('history');
const historyBtn = $<HTMLButtonElement>('historyBtn');
async function refreshHistory(): Promise<void> {
  if (historyPanel.hidden) return;
  const studentId = studentSel.value;
  if (!studentId) { historyPanel.replaceChildren(h('div', 'empty', 'Pick a student.')); return; }
  try {
    const items = await api.invoke('lessons:list', { studentId });
    if (!items.length) { historyPanel.replaceChildren(h('div', 'empty', 'No lessons yet.')); return; }
    historyPanel.replaceChildren(...items.map(({ lesson, reportPath }) => {
      const mins = lesson.endedAt ? Math.max(1, Math.round((Date.parse(lesson.endedAt) - Date.parse(lesson.startedAt)) / 60000)) : undefined;
      const label = `${new Date(lesson.startedAt).toLocaleString()} - ${lesson.subject ?? 'no subject'} - ${mins ? `${mins} min` : 'not finished'}`;
      const row = h('div', 'item', undefined);
      row.append(h('span', undefined, label));
      const b = h('button', 'small', reportPath ? 'Open report' : 'Finish lesson') as HTMLButtonElement;
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const p = reportPath ?? (await api.invoke('lesson:finish', { studentId, lessonId: lesson.id })).reportPath;
          if (!reportPath) void refreshHistory();
          await api.invoke('shell:openPath', p);
        } catch (e) { showError(`Could not finish lesson: ${(e as Error).message}`); b.disabled = false; }
      });
      row.append(b);
      return row;
    }));
  } catch (e) { showError(`Could not load history: ${(e as Error).message}`); }
}
historyBtn.addEventListener('click', () => { historyPanel.hidden = !historyPanel.hidden; void refreshHistory(); });
studentSel.addEventListener('change', () => void refreshHistory());

// Settings
$('gear').addEventListener('click', () => { const s = $('settings'); s.hidden = !s.hidden; });
function applySettings(s: Settings): void {
  $<HTMLInputElement>('sTop').checked = s.alwaysOnTop;
  $<HTMLInputElement>('sOpacity').value = String(s.opacity);
  $<HTMLInputElement>('sWindow').value = String(s.transcriptWindowMinutes);
  $<HTMLInputElement>('sShots').checked = s.screenshotsEnabled;
  $<HTMLSelectElement>('sModel').value = s.whisperModel;
  shotsOn = s.screenshotsEnabled; renderShot();
}
$('settings').querySelectorAll<HTMLButtonElement>('.sizes button').forEach((b) => b.addEventListener('click', () => {
  void api.invoke('window:setSize', { width: Number(b.dataset.w), height: Number(b.dataset.h) });
}));
const set = (p: Partial<Settings>) => api.invoke('settings:set', p);
$('sModel').addEventListener('change', (e) => { void set({ whisperModel: (e.target as HTMLSelectElement).value }); });
$('sTop').addEventListener('change', (e) => {
  const v = (e.target as HTMLInputElement).checked;
  void set({ alwaysOnTop: v }); void api.invoke('window:setAlwaysOnTop', v);
});
$('sOpacity').addEventListener('input', (e) => {
  const v = Math.min(1, Math.max(0.4, Number((e.target as HTMLInputElement).value)));
  void set({ opacity: v }); void api.invoke('window:setOpacity', v);
});
$('sWindow').addEventListener('change', (e) => {
  const v = Math.min(60, Math.max(1, Number((e.target as HTMLInputElement).value) || 5));
  void set({ transcriptWindowMinutes: v });
});
$('sShots').addEventListener('change', (e) => {
  shotsOn = (e.target as HTMLInputElement).checked; renderShot();
  void set({ screenshotsEnabled: shotsOn });
});

let shotsOn = true;
let shotAt: number | undefined;
function renderShot(): void {
  $('shotInd').textContent = !shotsOn ? 'screen: off'
    : shotAt ? `screen \u2713 ${new Date(shotAt).toLocaleTimeString([], { hour12: false })}` : 'screen: on';
}
api.on('screenshot:updated', (e) => { shotAt = e.capturedAt; renderShot(); });
api.on('state:changed', (s) => { state = s; render(); });

(async () => {
  await loadStudents();
  applySettings(await api.invoke('settings:get', undefined));
  state = await api.invoke('app:getState', undefined);
  render();
})().catch((e) => showError(`Startup error: ${(e as Error).message}`));
