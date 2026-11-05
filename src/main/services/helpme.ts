import type { HelpMeRequest, HelpMeResult } from '../../shared/types';
import type { HelpMeService, LlmClient } from '../../shared/interfaces';
import { LLM, MODELS } from '../../shared/config';
import { buildHelpMePrompt, extractPartialAnswer, parseHelpMeResponse } from './prompts';

export interface HelpMeOptions {
  timeoutMs?: number; retries?: number; model?: string; maxTokens?: number;
  effort?: 'low' | 'medium' | 'high'; now?: () => number;
}

export function createHelpMeService(llm: LlmClient, opts: HelpMeOptions = {}): HelpMeService {
  const now = opts.now ?? Date.now;
  return {
    async ask(req: HelpMeRequest, onDelta?: (partialAnswer: string) => void): Promise<HelpMeResult> {
      const fallbackTranscript = req.transcript;
      if (!llm.isConfigured()) {
        return { ok: false, error: 'ANTHROPIC_API_KEY is not set. Add it to .env and restart.', fallbackTranscript };
      }
      const errors: string[] = [];
      const attempts = 1 + (opts.retries ?? LLM.helpMeRetries);
      for (let i = 0; i < attempts; i++) {
        let raw = '';
        let shown = '';
        if (i > 0) onDelta?.('');
        try {
          const { system, content } = buildHelpMePrompt(req);
          const res = await llm.complete({
            model: opts.model ?? MODELS.helpMe, system, content,
            maxTokens: opts.maxTokens ?? LLM.helpMeMaxTokens,
            timeoutMs: opts.timeoutMs ?? LLM.helpMeTimeoutMs,
            effort: opts.effort ?? LLM.helpMeEffort,
            thinking: 'off',
            onText: onDelta ? (d) => {
              raw += d;
              const p = extractPartialAnswer(raw);
              if (p.length > shown.length) { shown = p; onDelta(p); }
            } : undefined,
          });
          return { ok: true, response: parseHelpMeResponse(res.text, now()) };
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      return { ok: false, error: `Help-me failed after ${attempts} attempt(s): ${errors.join(' | ')}`, fallbackTranscript };
    },
  };
}
