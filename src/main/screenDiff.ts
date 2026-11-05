/** Fraction of pixels whose luma differs by more than `lumaDelta` between two same-size bitmaps (BGRA by default). */
export function changedFraction(a: Uint8Array, b: Uint8Array, channels = 4, lumaDelta = 24): number {
  const n = Math.floor(Math.min(a.length, b.length) / channels);
  if (n === 0 || a.length !== b.length) return a.length === b.length ? 0 : 1;
  // BGRA/BGR byte order: index 0 = blue, 1 = green, 2 = red. Grayscale (1 channel) uses the value directly.
  const luma = (p: Uint8Array, i: number): number =>
    channels < 3 ? p[i] : 0.114 * p[i] + 0.587 * p[i + 1] + 0.299 * p[i + 2];
  let changed = 0;
  for (let k = 0; k < n; k++) {
    const i = k * channels;
    if (Math.abs(luma(a, i) - luma(b, i)) > lumaDelta) changed++;
  }
  return changed / n;
}
