# Future improvements

## Status (2026-11-05)
Verified on the author's Windows 11 PC: capture test, full lesson with Whisper transcription, Help-me with screenshot, report, latency fix, system-wide F9, streamed answers, per-student memory toggle and `context.md`. Not yet run: `npm run dist` installer build, hosted (OpenAI) transcription.

## Next up (ranked, agreed with the user at the end of the build session)
Batch A - felt in every lesson
1. **Ask a specific question**: a text box next to Help me ("explain this a simpler way", "is the student's answer right?"); the model answers that question with the same transcript + screenshot context.
2. **Answer history**: scroll back through earlier Help-me answers within the lesson instead of losing them on the next press.
3. **Pause recording button**: mutes both streams for private moments without ending the lesson.
4. **Default to `Xenova/whisper-tiny.en`** with a model dropdown in settings (tiny kept up in real time on the test PC; base lagged 10-15 s).

Batch B - resilience and convenience
5. **Lesson history panel**: list a student's past lessons with Open buttons for `report.md` (today only the end-of-lesson toast links to it).
6. **Finish an interrupted lesson**: the transcript is saved live, but a crash mid-lesson leaves no report; add a "Finish unfinished lesson" action that generates the report from the saved `transcript.jsonl`.

Free to do, no code
7. Run `npm run dist` once and install from `release\Tutor Copilot Setup 0.1.0.exe`.

## P1
- Settings screen polish (model dropdown, data-folder picker).
- Auto-pause when no lesson is running (today capture only runs during a lesson, so this is already the case; keep an eye on CPU use while idle).

## P2
- WebGPU acceleration for Whisper.
- Per-stream voice activity detection (VAD).
- Option to attach a screenshot only when Help-me is pressed (cheaper).
- Search in the student picker.
- Export report to PDF.

## P3
- Multi-student diarization.
- Zoom SDK integration.
- Cloud sync.
