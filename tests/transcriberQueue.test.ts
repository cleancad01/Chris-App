import { describe, expect, it } from 'vitest';
import { BoundedQueue } from '../src/renderer/transcriber/queue';

describe('BoundedQueue (transcriber backpressure)', () => {
  it('is FIFO under capacity and drops nothing', () => {
    const q = new BoundedQueue<number>(2);
    expect(q.push(1)).toBeUndefined();
    expect(q.push(2)).toBeUndefined();
    expect(q.size).toBe(2);
    expect(q.dropped).toBe(0);
    expect(q.shift()).toBe(1);
    expect(q.shift()).toBe(2);
    expect(q.shift()).toBeUndefined();
  });

  it('evicts the OLDEST pending item when full and counts it', () => {
    const q = new BoundedQueue<string>(2);
    q.push('a'); q.push('b');
    expect(q.push('c')).toBe('a');
    expect(q.push('d')).toBe('b');
    expect(q.size).toBe(2);
    expect(q.dropped).toBe(2);
    expect(q.drain()).toEqual(['c', 'd']);
    expect(q.size).toBe(0);
    expect(q.dropped).toBe(2); // drain is not a drop
  });

  it('keeps accepting after being consumed', () => {
    const q = new BoundedQueue<number>(2);
    q.push(1); q.push(2); q.shift();
    expect(q.push(3)).toBeUndefined();
    expect(q.drain()).toEqual([2, 3]);
  });

  it('rejects a non-positive capacity', () => {
    expect(() => new BoundedQueue(0)).toThrow();
  });
});
