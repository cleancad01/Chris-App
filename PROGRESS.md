# PROGRESS

## Done
- [x] M0: Project scaffold (Electron 45, esbuild, Vitest, TS), shared types/interfaces/IPC/config, ARCHITECTURE.md.

- [x] M1 (Tier 1 code complete, untested on real hardware): dual audio capture (mic + Electron loopback), Whisper worker (transformers.js) + hosted (OpenAI) + mock transcribers, storage, Anthropic LLM client, Help-me service (timeout + retry, never blank), report generator, Electron shell + UI with consent dialog, `npm run capture-test`. 49 unit tests pass. Verified here: build, typecheck, tests with mocks. NOT verified here: mic/loopback capture, Whisper in Electron worker, UI rendering.
- [x] Tier 2: real screenshot capture (desktopCapturer + change detection, header indicator) and renderer served over `app://` (Cache API for Whisper model). Untested on Windows.

- [x] Capture test passed on the user's Windows machine (mic + loopback + screenshot). Loopback now requests raw audio (no echo cancellation / noise suppression / AGC).

- [x] Full end-to-end lesson verified on the user's Windows machine: Whisper worker, speaker labels, Help-me (screenshot was used), report saved. Fixed: window.prompt unsupported in Electron; trailing chunks after End lesson raised errors.
- [x] Tier 3 polish: electron-builder NSIS installer (`npm run dist`), window-size presets (`window:setSize`), local model note in settings, `.env` also read next to the exe.
- [x] Transcription latency: one Whisper worker per speaker, per-speaker queue cap 2 (drop oldest, pill shows backlog/drops), 4 s chunks, multi-threaded WASM via COOP/COEP on `app://`, no `chunk_length_s` for <30 s input.
- [x] Final polish: system-wide F9 (globalShortcut), Help-me thinking off + streaming partial answer, smaller screenshot/max tokens, bigger default window (520x860) and help-panel layout fixes.
- [x] Per-student memory toggle (`Student.memoryEnabled`, `students:update`), `context.md` master context appended at lesson end and read (tail, 1500 chars) by Help-me/report when on; Help-me concepts capped at 30.

## Decisions
- Renderer is served via custom `app://tutor/` scheme (privileged, secure) with an explicit extension->MIME map and path-traversal guard, because file:// origins are opaque and cannot use the Cache API.
- Screenshot change detection: resize thumbnail to 32x32, compare BGRA luma per pixel (delta > 24); capture only when >= 2% pixels changed (`changedFraction` in `src/main/screenDiff.ts`). Keep newest 3 in memory.
- Electron 45.2.3; system audio via `setDisplayMediaRequestHandler` + `audio: 'loopback'` (Windows).
- Local STT: `@huggingface/transformers` Whisper (`Xenova/whisper-base.en`) in a Web Worker (WASM). Hosted option: OpenAI Whisper API via `OPENAI_API_KEY`.
- LLM: `@anthropic-ai/sdk`, model `claude-sonnet-5-5` for Help-me (effort low) and reports (effort medium). Names in `src/shared/config.ts`.
- JSON from the model parsed tolerantly (first `{...}` block); plain text falls back to `answer`. Never a blank panel.
- Storage: JSON + Markdown under `%APPDATA%/tutor-copilot/data/students/<id>/...` (override with `TUTOR_DATA_DIR`).
- TypeScript 5.9 (not 7.x) for tooling stability. No native modules.
- Branch: work is pushed to `main` (user request) and mirrored to `claude/elegant-babbage-fvxtr3`.

- userData is pinned to `%APPDATA%\tutor-copilot` via `app.setPath` so dev and packaged builds share `.env` and data.
- Live transcription prefers freshness over completeness: when a speaker's queue (cap 2) is full the oldest chunk is dropped; `TUTOR_WASM_THREADS=0` disables the COOP/COEP headers if threaded WASM breaks model loading.
- Global F9 is registered in main (`globalShortcut`) and sent to the renderer as `helpme:trigger`; it does not focus the window, so Zoom keeps focus.
- Thinking is turned off for Help-me via `thinking: { type: 'between_tools' }` (valid on claude-sonnet-5-5 with effort low); reports unchanged.
- Help-me streams: raw JSON text is accumulated and the `answer` field is extracted incrementally (`extractPartialAnswer`) and pushed as `helpme:partial`; the final result replaces it, partial resets on retry.
- Memory is always recorded (context.md, concepts.json) and only optionally read; `ReportGenerator.generate` takes `includePriorInPrompt` so merging still uses real memory when the prompt omits it.

## Next
- Waiting for the user's `npm run capture-test` output from Windows; fix mic/loopback/Whisper issues it reveals.
- Finishing: docs written (README, KNOWN_LIMITATIONS, FUTURE_IMPROVEMENTS); final verification pass and push.
