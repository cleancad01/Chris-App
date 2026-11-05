import { desktopCapturer, screen as electronScreen } from 'electron';
import type { ScreenCapture } from '../shared/interfaces';
import type { Screenshot } from '../shared/types';
import { SCREEN } from '../shared/config';
import { changedFraction } from './screenDiff';

export class NoopScreenCapture implements ScreenCapture {
  start(_intervalMs: number, _onShot: (shot: Screenshot) => void): void {}
  stop(): void {}
  latest(): Screenshot | undefined { return undefined; }
  recent(): Screenshot[] { return []; }
}

export class DesktopScreenCapture implements ScreenCapture {
  private timer?: NodeJS.Timeout;
  private running = false;
  private shots: Screenshot[] = []; // newest first
  private prev?: Uint8Array;
  private lastLog = 0;

  start(intervalMs: number, onShot: (shot: Screenshot) => void): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(onShot), intervalMs);
    void this.tick(onShot);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.prev = undefined;
  }

  latest(): Screenshot | undefined { return this.shots[0]; }
  recent(): Screenshot[] { return [...this.shots]; }

  private async tick(onShot: (shot: Screenshot) => void): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: SCREEN.maxWidth, height: Math.round((SCREEN.maxWidth * 9) / 16) },
      });
      const primaryId = String(electronScreen.getPrimaryDisplay().id);
      const src = sources.find((s) => s.display_id === primaryId) ?? sources[0];
      if (!src || src.thumbnail.isEmpty()) return;
      const image = src.thumbnail;
      const small = image.resize({ width: SCREEN.diffSize, height: SCREEN.diffSize }).toBitmap();
      const prev = this.prev;
      if (prev && changedFraction(prev, small) < SCREEN.changeThreshold) return;
      this.prev = small;
      const size = image.getSize();
      const shot: Screenshot = {
        capturedAt: Date.now(), mimeType: 'image/jpeg',
        dataBase64: image.toJPEG(SCREEN.jpegQuality).toString('base64'),
        width: size.width, height: size.height,
      };
      this.shots = [shot, ...this.shots].slice(0, SCREEN.keepRecent);
      onShot(shot);
    } catch (e) {
      if (Date.now() - this.lastLog > 60_000) {
        this.lastLog = Date.now();
        console.error('Screen capture failed:', (e as Error).message);
      }
    } finally { this.running = false; }
  }
}

export function createScreenCapture(opts: { enabled: boolean }): ScreenCapture {
  return opts.enabled ? new DesktopScreenCapture() : new NoopScreenCapture();
}
