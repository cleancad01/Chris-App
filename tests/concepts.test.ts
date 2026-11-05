import { describe, expect, it } from 'vitest';
import { mergeConcepts } from '../src/main/services/concepts';
import type { Concept } from '../src/shared/types';

const c = (name: string, status: Concept['status'], d = 'd', f = 'L1', l = 'L1'): Concept => ({ name, description: d, status, firstLessonId: f, lastLessonId: l });

describe('mergeConcepts', () => {
  it('updates case-insensitively, keeps first lesson, appends new, keeps old', () => {
    const r = mergeConcepts([c('Fractions', 'introduced'), c('Decimals', 'mastered')], [c('fractions', 'practiced', 'new desc'), c('Ratios', 'introduced')], 'L2');
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({ name: 'Fractions', description: 'new desc', status: 'practiced', firstLessonId: 'L1', lastLessonId: 'L2' });
    expect(r[1].name).toBe('Decimals');
    expect(r[2]).toMatchObject({ name: 'Ratios', firstLessonId: 'L2', lastLessonId: 'L2' });
  });
  it('allows mastered -> struggling', () => {
    expect(mergeConcepts([c('A', 'mastered')], [c('A', 'struggling')], 'L2')[0].status).toBe('struggling');
  });
  it('does not mutate input', () => {
    const ex = [c('A', 'introduced')];
    mergeConcepts(ex, [c('A', 'mastered')], 'L2');
    expect(ex[0].status).toBe('introduced');
  });
});
