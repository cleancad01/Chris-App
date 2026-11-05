# Audio capture notes

## How it works
- **Tutor = microphone.** `MicAudioSource` uses `getUserMedia({audio:{echoCancellation, noiseSuppression}})`.
  Echo cancellation also strips the student's voice that leaks from the tutor's speakers into the mic.
- **Student = system audio (loopback).** `LoopbackAudioSource` calls `getDisplayMedia({audio:true, video:true})`.
  Main answers it in `session.setDisplayMediaRequestHandler` with `{ video: <screen source>, audio: 'loopback' }`,
  which makes Chromium capture the Windows default output device via WASAPI loopback (everything Zoom plays).
  Chromium requires a video track, so the renderer stops it immediately and keeps only the audio track.
- Both streams go through `AudioContext({sampleRate:16000})` (Chromium resamples) and a `ScriptProcessorNode`
  (1 channel, speaker downmix) into `PcmChunker`, which emits `AUDIO.chunkSeconds` (4 s) `AudioChunk`s with wall-clock timestamps and
  drops chunks with RMS < `AUDIO.silenceRms` (0.005).
- Transcription: `LocalWhisperTranscriber` runs `Xenova/whisper-base.en` (q8, WASM) in `whisper.worker.js`.
  The model (~80 MB) downloads from Hugging Face on first run and is kept in the Cache API; later runs are offline
  except the ONNX Runtime `.wasm` (loaded from jsDelivr, then HTTP-cached). Output is filtered by
  `cleanTranscriptText` (drops `[BLANK_AUDIO]`, `(silence)`, lone/repeated "Thank you.", etc.).
- One worker per speaker (tutor and student transcribe in parallel), loaded one after the other so the model is
  downloaded once into the Cache API. Each worker keeps at most 2 chunks waiting; a newer chunk evicts the oldest.
- Multi-threaded WASM: `app://` responses carry `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: credentialless`, making the page `crossOriginIsolated` so onnxruntime-web can use
  SharedArrayBuffer threads (the worker logs `crossOriginIsolated`, `hardwareConcurrency` and `numThreads` at start).
  **If the model fails to load after this change, set `TUTOR_WASM_THREADS=0`** (in `.env`) to drop the headers.

## What the user must do on Windows
1. Run `npm run capture-test` once. Speak and play a video for 10 s; check the summary and
   `capture-test-output/mic.wav`, `system.wav`, `screenshot.png`.
2. Windows Settings -> Privacy & security -> Microphone: turn on "Microphone access" and
   "Let desktop apps access your microphone". Otherwise the mic stream is silent or fails with NotAllowedError.
3. Make sure Zoom plays through the **default** output device (loopback captures the default device only).

## Known risks
- Loopback captures *all* system audio (notifications, videos, the tutor's own voice if Zoom echoes it). Speaker
  labels come from the stream, not from voice recognition.
- If the tutor uses headphones the mic will not hear the student (good); with speakers, echo cancellation must
  remove the student from the mic or lines get duplicated under "Tutor".
- `audio: 'loopback'` is Windows-only (macOS needs a different path; Linux is unsupported).
- Stopping the loopback video track immediately is believed safe in Electron 45; the capture test does the same
  thing, so if `system.wav` is silent while audio plays, keep the video track alive instead.
- Module workers loaded from `file://` and the jsDelivr ONNX Runtime download are untested here (no display in CI);
  first-run model download needs internet. whisper-base on WASM takes ~1-3 s per 4 s chunk on a typical laptop;
  if it falls behind, switch the model to `Xenova/whisper-tiny.en` or the hosted transcriber.
- `ScriptProcessorNode` is deprecated but still supported in Chromium; it runs on the main thread, so a very busy
  renderer can drop audio frames.
