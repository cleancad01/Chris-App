import type { Lesson, LessonReport, Student, StudentMemory, TranscriptSegment } from '../../shared/types';
import type { LlmClient, ReportGenerator } from '../../shared/interfaces';
import { LLM, MODELS } from '../../shared/config';
import { buildReportPrompt, fallbackReport, parseReport } from './prompts';
import { mergeConcepts } from './concepts';
import { formatTranscript } from './transcriptWindow';

export interface ReportOptions {
  timeoutMs?: number; retries?: number; model?: string; maxTokens?: number; effort?: 'low' | 'medium' | 'high';
}

const bullets = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : '- (none)');
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function createReportGenerator(llm: LlmClient, opts: ReportOptions = {}): ReportGenerator {
  return {
    async generate(input: { lesson: Lesson; student: Student; transcript: TranscriptSegment[]; priorMemory: StudentMemory; includePriorInPrompt?: boolean; priorContext?: string }): Promise<LessonReport> {
      let parsed = fallbackReport();
      if (llm.isConfigured() && input.transcript.length > 0) {
        const attempts = 1 + (opts.retries ?? LLM.reportRetries);
        for (let i = 0; i < attempts; i++) {
          try {
            const { system, content } = buildReportPrompt({
              ...input,
              priorMemory: input.includePriorInPrompt === false
                ? { studentId: input.student.id, concepts: [], lessonSummaries: [] }
                : input.priorMemory,
            });
            const res = await llm.complete({
              model: opts.model ?? MODELS.report, system, content,
              maxTokens: opts.maxTokens ?? LLM.reportMaxTokens,
              timeoutMs: opts.timeoutMs ?? LLM.reportTimeoutMs,
              effort: opts.effort ?? LLM.reportEffort,
            });
            parsed = parseReport(res.text, input.lesson.id);
            break;
          } catch {
            /* retry, then fall back */
          }
        }
      }
      return { ...parsed, concepts: mergeConcepts(input.priorMemory.concepts, parsed.concepts, input.lesson.id) };
    },

    renderMarkdown({ lesson, student, report, transcript }): string {
      const start = new Date(lesson.startedAt);
      const end = lesson.endedAt ? new Date(lesson.endedAt) : undefined;
      const mins = end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000)) : undefined;
      // Local date/time for humans (ISO strings in lesson.json stay UTC).
      const pad = (n: number): string => String(n).padStart(2, '0');
      const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const localTime = (d: Date): string => `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      const date = localDate(start);
      const rows = report.concepts.map((c) => `| ${cell(c.name)} | ${c.status} | ${cell(c.description)} |`).join('\n');
      return `## Lesson report - ${student.name} - ${date}

- Started: ${localTime(start)}
- Ended: ${end ? localTime(end) : 'n/a'}
- Duration: ${mins !== undefined ? `${mins} min` : 'n/a'}
- Subject: ${lesson.subject ?? 'n/a'}

### Overview
${report.overview}

### What the student learned
${bullets(report.learned)}

### Not yet learned
${bullets(report.yetToLearn)}

### Where they struggled
${bullets(report.struggles)}

### Suggested next steps
${bullets(report.nextSteps)}

### Concept roadmap
| Concept | Status | Description |
|---|---|---|
${rows}

### Full transcript
${formatTranscript(transcript) || '(empty)'}
`;
    },
  };
}
