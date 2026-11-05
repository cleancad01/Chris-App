import type { ScreenCapture } from '../shared/interfaces';
import type { Screenshot } from '../shared/types';

/** Placeholder: real desktopCapturer implementation comes in the next batch. */
export class NoopScreenCapture implements ScreenCapture {
  start(_intervalMs: number, _onShot: (shot: Screenshot) => void): void {}
  stop(): void {}
  latest(): Screenshot | undefined { return undefined; }
  recent(): Screenshot[] { return []; }
}

export function createScreenCapture(_opts: { enabled: boolean }): ScreenCapture {
  return new NoopScreenCapture();
}
