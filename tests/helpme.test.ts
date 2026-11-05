import { describe, expect, it } from 'vitest';
import { createHelpMeService } from '../src/main/services/helpme';
import { MockLlmClient, mockHelpMeJson } from '../src/main/services/llm';
import type { HelpMeRequest } from '../src/shared/types';

const req: HelpMeRequest = {
  transcript: [{ id: '1', speaker: 'tutor', text: 'Solve x+1=2', startMs: 1, endMs: 2 }],
  context: { studentName: 'A', concepts: [], priorLessonSummaries: [] },
};

describe('HelpMeService', () => {
  it('succeeds', async () => {
    const llm = new MockLlmClient();
    llm.respond = () => mockHelpMeJson('x=1');
    const r = await createHelpMeService(llm, { now: () => 42 }).ask(req);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.response.answer).toBe('x=1'); expect(r.response.createdAt).toBe(42); }
    expect(llm.calls).toHaveLength(1);
  });
  it('retries once after a throw', async () => {
    const llm = new MockLlmClient();
    let n = 0;
    llm.respond = () => { if (n++ === 0) throw new Error('boom'); return mockHelpMeJson(); };
    const r = await createHelpMeService(llm).ask(req);
    expect(r.ok).toBe(true);
    expect(llm.calls).toHaveLength(2);
  });
  it('fails gracefully with fallback transcript', async () => {
    const llm = new MockLlmClient();
    llm.respond = () => { throw new Error('down'); };
    const r = await createHelpMeService(llm).ask(req);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.error).toContain('down'); expect(r.fallbackTranscript.length).toBeGreaterThan(0); }
    expect(llm.calls).toHaveLength(2);
  });
  it('reports unconfigured', async () => {
    const llm = new MockLlmClient();
    llm.configured = false;
    const r = await createHelpMeService(llm).ask(req);
    expect(r).toMatchObject({ ok: false, error: 'ANTHROPIC_API_KEY is not set. Add it to .env and restart.' });
    expect(llm.calls).toHaveLength(0);
  });
});
