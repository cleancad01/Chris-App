# PROGRESS

## Done
- [x] M0: Project scaffold (Electron 45, esbuild, Vitest, TS), shared types/interfaces/IPC/config, ARCHITECTURE.md.

## Decisions
- Electron 45.2.3; system audio via `setDisplayMediaRequestHandler` + `audio: 'loopback'` (Windows).
- Local STT: `@huggingface/transformers` Whisper (`Xenova/whisper-base.en`) in a Web Worker (WASM). Hosted option: OpenAI Whisper API via `OPENAI_API_KEY`.
- LLM: `@anthropic-ai/sdk`, model `claude-sonnet-5-5` for Help-me (effort low) and reports (effort medium). Names in `src/shared/config.ts`.
- JSON from the model parsed tolerantly (first `{...}` block); plain text falls back to `answer`. Never a blank panel.
- Storage: JSON + Markdown under `%APPDATA%/tutor-copilot/data/students/<id>/...` (override with `TUTOR_DATA_DIR`).
- TypeScript 5.9 (not 7.x) for tooling stability. No native modules.
- Branch: work is pushed to `main` (user request) and mirrored to `claude/elegant-babbage-fvxtr3`.

## Next
- Batch 1: audio capture + transcriber + capture-test (Opus); storage/LLM/help-me/report/tests (Sonnet); main/preload/UI (Sonnet).
