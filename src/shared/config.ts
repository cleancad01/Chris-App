/** Single place for model names and tunables. */
export const MODELS = {
  /** Help-me answers: fast, cheap, good. */
  helpMe: 'claude-sonnet-5-5',
  /** End-of-lesson report. */
  report: 'claude-sonnet-5-5',
} as const;

export const LLM = {
  helpMeTimeoutMs: 45_000,
  helpMeRetries: 1,
  helpMeMaxTokens: 900,
  helpMeEffort: 'low' as const,
  reportTimeoutMs: 120_000,
  reportRetries: 1,
  reportMaxTokens: 6000,
  reportEffort: 'medium' as const,
} as const;

export const AUDIO = {
  sampleRate: 16000 as const,
  /** Seconds of audio per transcription chunk. */
  chunkSeconds: 4,
  /** RMS below this is treated as silence and skipped. */
  silenceRms: 0.005,
} as const;

export const SCREEN = {
  intervalMs: 10_000,
  keepRecent: 3,
  /** Downscaled thumbnail for change detection. */
  diffSize: 32,
  /** Fraction of thumbnail pixels that must change to count as "meaningfully changed". */
  changeThreshold: 0.02,
  maxWidth: 1024,
  jpegQuality: 70,
} as const;

export const DEFAULT_SETTINGS = {
  transcriptWindowMinutes: 5,
  transcriber: 'local' as const,
  whisperModel: 'Xenova/whisper-base.en',
  screenshotIntervalSec: 10,
  screenshotsEnabled: true,
  alwaysOnTop: true,
  opacity: 1,
};

export const APP_NAME = 'tutor-copilot';
