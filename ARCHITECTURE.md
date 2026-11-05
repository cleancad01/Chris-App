# Tutor Copilot - Architecture

Electron + TypeScript desktop app for Windows 10/11. No native modules; everything is bundled with esbuild.

## Processes

```
┌─────────────── Renderer (always-on-top window) ───────────────┐
│ UI: transcript view, Help-me button + panel, student picker,   │
│     consent dialog, level meters, settings.                    │
│ Audio: MicAudioSource (getUserMedia)        -> "tutor"         │
│        LoopbackAudioSource (getDisplayMedia  -> "student"      │
│          + Electron loopback audio)                            │
│        FakeAudioSource (replays sample)      -> tests/mocks    │
│ Transcriber: LocalWhisperTranscriber (Web Worker, transformers.js)
│              HostedTranscriber (OpenAI Whisper API, optional)  │
│              MockTranscriber                                   │
└──────────────── window.api (preload, contextIsolation) ───────┘
                              │ IPC (src/shared/ipc.ts)
┌─────────────── Main ──────────────────────────────────────────┐
│ LessonSession: state machine (idle -> running -> ending)       │
│ Storage (JSON + Markdown files, one folder per student)        │
│ ScreenCapture (desktopCapturer every ~10s, diff, keep last 3)  │
│ LlmClient (Anthropic SDK, Sonnet) + MockLlmClient              │
│ HelpMeService (prompt build, timeout, retry, never blank)      │
│ ReportGenerator (structured report + Markdown render)          │
│ ConceptMemory (merge concepts across lessons)                  │
└───────────────────────────────────────────────────────────────┘
```

Why audio lives in the renderer: `getUserMedia`/`getDisplayMedia` and AudioWorklets are Web APIs. Main grants
system audio with `session.setDisplayMediaRequestHandler(..., { audio: 'loopback' })` (Electron >= 31, Windows only).
Two separate streams give speaker labels for free: mic = Tutor, loopback = Student.

## Data flow

1. AudioSource emits 5 s `AudioChunk`s (16 kHz mono float32); silent chunks are dropped.
2. Transcriber turns chunks into `TranscriptSegment[]` (speaker-labelled, wall-clock timestamps).
3. Renderer shows segments and sends them to main (`transcript:append`), which appends to `transcript.jsonl`.
4. ScreenCapture (main) grabs a screenshot every ~10 s, skips unchanged screens, keeps the last 3 in memory.
5. Help-me (`helpme:ask`): main takes the transcript window (default 5 min), the latest screenshot and the
   `LessonContext` (student concepts, prior lesson summaries, running summary), builds a compact prompt,
   calls Sonnet with a timeout and one retry, parses JSON tolerantly, and returns `HelpMeResult`.
   On failure the result carries the transcript window so the panel is never blank.
6. End lesson (`lesson:end`): ReportGenerator sends the full transcript + prior memory to Sonnet, gets a
   `LessonReport`, writes `report.md`/`report.json`, merges concepts into `concepts.json`.

## Contract files (build everything against these)

- `src/shared/types.ts`      domain types
- `src/shared/interfaces.ts` module interfaces + on-disk layout
- `src/shared/ipc.ts`        IPC channels and `window.api`
- `src/shared/config.ts`     model names and tunables

## Folder ownership

| Path | Owner |
|---|---|
| `src/renderer/audio/*`, `src/renderer/transcriber/*`, `scripts/capture-test/*` | audio/transcription |
| `src/main/services/{storage,llm,helpme,report,prompts,concepts,transcriptWindow}.ts`, `tests/*` | services |
| `src/main/index.ts`, `src/main/session.ts`, `src/main/screen.ts`, `src/preload/*`, `src/renderer/{index.ts,ui/*,static/*}` | shell/UI |

## Testing strategy

The cloud build environment has no mic, speakers or display. Audio and screen sources are behind interfaces
with fake implementations, so the Help-me flow, storage, prompts and report generation are unit-tested with
Vitest and a `MockLlmClient`. Real capture is verified on the user's Windows machine via `npm run capture-test`.
