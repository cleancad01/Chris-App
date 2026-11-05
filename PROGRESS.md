# PROGRESS

## Done
- [x] M0: Project scaffold (Electron 45, esbuild, Vitest, TS), shared types/interfaces/IPC/config, ARCHITECTURE.md.

- [x] M1 (Tier 1 code complete, untested on real hardware): dual audio capture (mic + Electron loopback), Whisper worker (transformers.js) + hosted (OpenAI) + mock transcribers, storage, Anthropic LLM client, Help-me service (timeout + retry, never blank), report generator, Electron shell + UI with consent dialog, `npm run capture-test`. 49 unit tests pass. Verified here: build, typecheck, tests with mocks. NOT verified here: mic/loopback capture, Whisper in Electron worker, UI rendering.
- [x] Tier 2: real screenshot capture (desktopCapturer + change detection, header indicator) and renderer served over `app://` (Cache API for Whisper model). Untested on Windows.

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

## Next
- Wait for the user's `npm run capture-test` output; fix loopback/mic issues if any.
- Batch 2 (Tier 2): real screenshot capture (desktopCapturer, change detection, keep last 3), serve renderer over a custom `app://` scheme so the Cache API persists the Whisper model, memory roadmap polish.
- Finishing: README, KNOWN_LIMITATIONS, FUTURE_IMPROVEMENTS.
