/**
 * Pure bounded FIFO used for transcription backpressure. When full, push() evicts the OLDEST item
 * (live transcription prefers fresh audio over stale audio) and counts it in `dropped`.
 */
export class BoundedQueue<T> {
  private items: T[] = [];
  dropped = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`BoundedQueue capacity must be >= 1, got ${capacity}`);
  }

  /** Enqueue; returns the evicted oldest item when the queue was full, else undefined. */
  push(item: T): T | undefined {
    let evicted: T | undefined;
    if (this.items.length >= this.capacity) {
      evicted = this.items.shift();
      this.dropped++;
    }
    this.items.push(item);
    return evicted;
  }

  shift(): T | undefined {
    return this.items.shift();
  }

  /** Remove and return everything (e.g. on dispose). */
  drain(): T[] {
    const out = this.items;
    this.items = [];
    return out;
  }

  get size(): number {
    return this.items.length;
  }
}
