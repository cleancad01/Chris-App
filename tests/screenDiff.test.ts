import { describe, expect, it } from 'vitest';
import { changedFraction } from '../src/main/screenDiff';

const img = (px: number, v: number) => new Uint8Array(px * 4).fill(v);

describe('changedFraction', () => {
  it('is 0 for identical images', () => expect(changedFraction(img(100, 50), img(100, 50))).toBe(0));
  it('is 1 for fully different images', () => expect(changedFraction(img(100, 0), img(100, 255))).toBe(1));
  it('ignores tiny luma differences', () => expect(changedFraction(img(100, 100), img(100, 110))).toBe(0));
  it('reports the partial fraction', () => {
    const a = img(100, 0), b = img(100, 0);
    b.fill(255, 0, 25 * 4);
    expect(changedFraction(a, b)).toBeCloseTo(0.25, 5);
  });
  it('treats size mismatch as changed', () => expect(changedFraction(img(10, 0), img(20, 0))).toBe(1));
});
