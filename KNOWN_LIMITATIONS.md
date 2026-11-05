# Known limitations

- **Not tested on real hardware yet.** See the Verification status table in `README.md`.
- **Windows only.** System-audio loopback (`audio: 'loopback'`) is Windows-only in Electron.
- **Default output device only.** Loopback captures the Windows default output device; if Zoom plays elsewhere, the Student stream is silent. It also captures every other system sound (notifications, videos).
- **Speaker labels come from stream separation, not voice recognition.** If the tutor's voice leaks into system audio (for example Zoom echo), it may be labelled Student. With speakers instead of headphones, the student may also leak into the mic and appear as Tutor.
- **No diarization within a stream.** Two students on the call share the single label Student.
- **Whisper may lag.** `whisper-base.en` on CPU/WASM can fall behind real time with two streams. Switch to `Xenova/whisper-tiny.en` (`TUTOR_WHISPER_MODEL`) or hosted transcription.
- **First run needs internet** to download the Whisper model and the ONNX runtime.
- **Silence hallucinations are filtered heuristically.** Phrases such as `[BLANK_AUDIO]` or a lone "Thank you." are dropped, but some junk text can still slip through.
- **Help-me always sends the latest screenshot**, which increases cost per press.
- **Report quality depends on transcript quality.**
- **No installer.** Run from source with `npm start`.
- **API key stored in plain text** in `.env`.
- **Zoom audio settings matter.** "Original sound" and noise suppression settings in Zoom may affect what is captured.
- **ScriptProcessorNode** (deprecated but supported) runs on the renderer main thread; a very busy renderer can drop audio frames.
