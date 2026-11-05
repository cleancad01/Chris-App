import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmContentBlock, LlmRequest, LlmResponse } from '../../shared/interfaces';

export class AnthropicLlmClient implements LlmClient {
  private client?: Anthropic;

  private key(): string | undefined {
    return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const apiKey = this.key();
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    this.client ??= new Anthropic({ apiKey });
    const content = req.content.map((b) =>
      b.type === 'text'
        ? { type: 'text' as const, text: b.text }
        : { type: 'image' as const, source: { type: 'base64' as const, media_type: b.mimeType, data: b.dataBase64 } },
    );
    const params: any = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: [{ role: 'user', content }],
    };
    if (req.effort) params.output_config = { effort: req.effort };
    if (req.thinking === 'off') params.thinking = { type: 'between_tools' };
    let res: any;
    if (req.onText) {
      const onText = req.onText;
      const stream = this.client.messages.stream(params, { timeout: req.timeoutMs, maxRetries: 0 });
      stream.on('text', (delta: string) => onText(delta));
      res = await stream.finalMessage();
    } else {
      res = await this.client.messages.create(params, { timeout: req.timeoutMs, maxRetries: 0 });
    }
    if (res.stop_reason === 'refusal') throw new Error('Model refused: the request was declined by the model');
    const text = (res.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return { text, inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens };
  }
}

export function mockHelpMeJson(answer = 'Mock answer.'): string {
  return JSON.stringify({
    answer, confidence: 'High - mock', overview: 'Mock overview.',
    connections: [{ concept: 'Fractions', relation: 'Related.', source: 'past-lesson' }],
    updatedRunningSummary: 'Mock running summary.',
  });
}

export function mockReportJson(): string {
  return JSON.stringify({
    overview: 'The student practised solving linear equations.',
    learned: ['Isolating a variable'], yetToLearn: ['Quadratics'], struggles: ['Negative coefficients'],
    nextSteps: ['Review negative numbers'],
    concepts: [{ name: 'Linear equations', description: 'Solving ax+b=c', status: 'practiced' }],
    lessonSummary: 'Worked on linear equations.',
  });
}

export class MockLlmClient implements LlmClient {
  calls: LlmRequest[] = [];
  configured = true;
  respond: (req: LlmRequest) => string = (req) =>
    req.system.includes('end-of-lesson') ? mockReportJson() : mockHelpMeJson();

  isConfigured(): boolean {
    return this.configured;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const text = this.respond(req);
    if (req.onText) {
      const a = Math.floor(text.length / 3), b = Math.floor((2 * text.length) / 3);
      for (const piece of [text.slice(0, a), text.slice(a, b), text.slice(b)]) if (piece) req.onText(piece);
    }
    return { text, inputTokens: 0, outputTokens: 0 };
  }
}

export type { LlmContentBlock };
