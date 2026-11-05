# Tutor Copilot

An always-on-top Windows desktop copilot for tutors teaching over Zoom (Electron 45 + TypeScript).

## What it does

- **Live speaker-labelled transcript.** Your microphone is labelled **Tutor**; system audio (what Zoom plays) is labelled **Student**.
- **Help-me panel.** Gives an answer, a short overview and a concept roadmap, using the transcript window and the latest screenshot of your screen.
- **End-of-lesson report.** A Markdown report plus per-student concept memory that carries over to later lessons.
- **Always-on-top window** that sits beside Zoom.

## Requirements

- Windows 10 or 11 (system-audio loopback is Windows-only)
- Node.js 22 LTS and Git
- An Anthropic API key (see below)
- Internet on first run: the Whisper model (roughly 80 MB, see `docs/AUDIO.md`) and the ONNX runtime are downloaded once

## Windows setup

1. Clone and enter the repo:
   ```
   git clone https://github.com/cleancad01/Chris-App.git
   cd Chris-App
   ```
2. `npm install`
3. Copy the example config: `copy .env.example .env`
4. Open `.env` and set `ANTHROPIC_API_KEY=sk-ant-...`
5. Optional: set `OPENAI_API_KEY` to use hosted transcription instead of local Whisper, and `TUTOR_DATA_DIR` to store data elsewhere.
6. Windows Settings -> Privacy & security -> Microphone: allow microphone access and "Let desktop apps access your microphone".

### Getting an Anthropic API key

Go to https://console.anthropic.com -> **API Keys** -> **Create key**, and copy it into `.env`. Billing (credits) must be set up on the account or requests will fail.

## Running

```
npm start
```

On first run the Whisper model downloads; the status pill in the header shows progress. Later runs reuse the cached model.

Workflow:

1. Pick an existing student or create one.
2. Optionally enter a subject.
3. Click **Start lesson**. Confirm the consent dialog. The app shows **Listening**.
4. Click **Help me** (or press **F9** / **Ctrl+Enter**) when you want suggestions.
5. Click **End lesson**. A toast shows the report path with an **Open** button.

Make sure Zoom plays through the **default** Windows output device, otherwise the Student stream is silent.

## Environment flags

Set in `.env` or the shell.

| Variable | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Required for Help-me and reports (unless `TUTOR_MOCK_LLM=1`). |
| `OPENAI_API_KEY` | Enables hosted transcription (OpenAI Whisper). If set and `TUTOR_TRANSCRIBER` is unset, hosted is used. |
| `TUTOR_MOCK_AUDIO=1` | Fake audio plus a scripted mock transcript, no mic needed. Use `npm run dev`. |
| `TUTOR_MOCK_LLM=1` | Fake model answers; no API cost. |
| `TUTOR_TRANSCRIBER` | `local`, `hosted` or `mock`. Default: `mock` with mock audio, `hosted` if `OPENAI_API_KEY` is set, else `local`. |
| `TUTOR_WHISPER_MODEL` | Local model. Default `Xenova/whisper-base.en`; `Xenova/whisper-tiny.en` is faster on slow PCs. |
| `TUTOR_WASM_THREADS=0` | Disables multi-threaded Whisper WASM (drops the COOP/COEP headers on `app://`). Use it if the Whisper model fails to load. |
| `TUTOR_DATA_DIR` | Data folder. Default `%APPDATA%\tutor-copilot\data`. |

`.env` is read from the app folder and from `%APPDATA%\tutor-copilot\.env`; real environment variables take precedence.

## Capture test

```
npm run capture-test
```

A standalone diagnostic. It records about 10 seconds of microphone and system audio, grabs one screenshot, prints a summary (devices, RMS/peak levels, errors) and exits 0 on success, 1 on failure. Speak and play a video while it runs. Look in `capture-test-output/`:

- `mic.wav`: should contain your voice
- `system.wav`: should contain the video/Zoom audio
- `screenshot.png`: should show your screen

A "(near) silent" warning in the summary means that stream captured nothing. Run this first on a new machine.

## Data storage

The app pins Electron's userData folder to `%APPDATA%\tutor-copilot` in both dev and packaged builds. Default data location `%APPDATA%\tutor-copilot\data` (override with `TUTOR_DATA_DIR`):

```
<dataDir>/
  settings.json
  students/<studentId>/student.json
  students/<studentId>/concepts.json                     per-student concept memory
  students/<studentId>/lessons/<lessonId>/lesson.json
  students/<studentId>/lessons/<lessonId>/transcript.jsonl   appended live
  students/<studentId>/lessons/<lessonId>/report.md
  students/<studentId>/lessons/<lessonId>/report.json
```

`report.md` contains: Overview, What the student learned, Not yet learned, Where they struggled, Suggested next steps, Concept roadmap, and the Full transcript.

## Building an installer

On Windows run `npm run dist`. The installer is written to `release/Tutor Copilot Setup 0.1.0.exe` (NSIS, lets you pick the install folder).

After installing, put your `.env` in `%APPDATA%\tutor-copilot\.env` (userData) or next to `Tutor Copilot.exe`. The app pins userData to `%APPDATA%\tutor-copilot` (rather than Electron's default `%APPDATA%\Tutor Copilot` for a packaged build), so dev and installed builds share the same `.env` and data. Set `TUTOR_WHISPER_MODEL=Xenova/whisper-tiny.en` there for slower PCs.

## Cost notes

- **Help-me** uses `claude-sonnet-5-5` with about a 5-minute transcript window plus one screenshot, every press.
- **Report** uses the full transcript once per lesson (same model).
- Model names and limits live in `src/shared/config.ts`.
- Local Whisper is free; hosted transcription bills your OpenAI account per audio chunk.

## Development

| Command | Does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests |
| `npm run build` | esbuild bundle to `dist/` |
| `npm run check` | typecheck + test + build |
| `npm run dev` | build and run with mock audio |
| `npm run watch` | rebuild on change |

See `ARCHITECTURE.md` (design), `docs/AUDIO.md` (audio capture notes) and `PROGRESS.md` (status). Also: `KNOWN_LIMITATIONS.md`, `FUTURE_IMPROVEMENTS.md`.

## Verification status

The code was built in a cloud environment with no microphone, speakers or display. Be aware of what has and has not been run on real hardware.

| Component | Verified in cloud build (unit tests/mocks) | Verified on Windows (capture test, 2026-11-05) | Still needs testing on Windows |
|---|---|---|---|
| Storage (students, lessons, transcripts) | Yes | | |
| Prompt building | Yes | | |
| Help-me timeout/retry/fallback logic | Yes | | |
| Report rendering | Yes | | |
| Transcript windowing | Yes | | |
| Concept memory merge | Yes | | |
| Screenshot change detection (diff) | Yes | | |
| Build and typecheck | Yes | | |
| Microphone capture (capture-test) | | Yes | |
| System-audio loopback capture (capture-test) | | Yes | |
| Whisper worker inside Electron | | Yes | |
| Screenshot capture (desktopCapturer) | | Yes | |
| UI rendering and interaction | | Yes | |
| `app://` scheme and Whisper model cache persistence | | Yes | |
| Anthropic calls with a real API key | | Yes | |
| Hosted (OpenAI) transcription | | | Yes |
| Whisper model cache across restarts (second launch should not re-download) | | | Yes |

`npm run capture-test` passed on the author's Windows 11 machine (Realtek mic, Electron 45.2.3): mic and loopback both recorded signal, screenshot saved. A full lesson (`npm start`: Whisper transcription of both streams, Help-me with screenshot, report file) also ran successfully on that machine the same day.
