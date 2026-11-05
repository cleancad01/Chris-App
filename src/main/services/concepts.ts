import type { Concept } from '../../shared/types';

export function mergeConcepts(existing: Concept[], incoming: Concept[], lessonId: string): Concept[] {
  const out = existing.map((c) => ({ ...c }));
  const idx = new Map(out.map((c, i) => [c.name.trim().toLowerCase(), i]));
  for (const inc of incoming) {
    const key = inc.name.trim().toLowerCase();
    if (!key) continue;
    const i = idx.get(key);
    if (i === undefined) {
      idx.set(key, out.length);
      out.push({ ...inc, firstLessonId: lessonId, lastLessonId: lessonId });
    } else {
      const cur = out[i];
      out[i] = {
        ...cur,
        description: inc.description || cur.description,
        status: inc.status, // newest evidence wins, including mastered -> struggling
        lastLessonId: lessonId,
      };
    }
  }
  return out;
}
