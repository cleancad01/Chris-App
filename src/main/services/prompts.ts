import type {
  Concept, ConceptStatus, ConnectionItem, ConnectionSource, HelpMeRequest, HelpMeResponse, Lesson, LessonReport,
  Student, StudentMemory, TranscriptSegment,
} from '../../shared/types';
import type { LlmContentBlock } from '../../shared/interfaces';
import { formatTranscript, truncateToChars } from './transcriptWindow';

export const HELPME_SYSTEM = `You are a copilot for a tutor during a live lesson. You see a transcript (Tutor = the person you assist, Student = the learner), optionally a screenshot, and lesson context.
Respond ONLY with a JSON object (no prose, no code fences):
{"answer": string, "confidence": string, "overview": string, "connections": [{"concept": string, "relation": string, "source": "this-lesson" | "past-lesson" | "new"}], "updatedRunningSummary": string}
Rules:
- ALWAYS give your best direct answer to the most recent question or problem being discussed. If none is explicit, answer what the student most likely needs. Never refuse or defer for lack of certainty; put any uncertainty in "confidence" as a one-line note.
- Keep "answer" under ~100 words; give worked steps when it is a math or coding problem.
- "overview": 1-3 sentences on what is being discussed.
- "connections": relate the discussion to concepts in the provided concept list (source "this-lesson" or "past-lesson"), or "new" for concepts not in the list. May be empty.
- "updatedRunningSummary": 1-3 sentences summarising the lesson so far.`;

export function buildHelpMePrompt(req: HelpMeRequest): { system: string; content: LlmContentBlock[] } {
  const c = req.context;
  const content: LlmContentBlock[] = [];
  if (req.screenshot) {
    content.push({ type: 'image', mimeType: req.screenshot.mimeType, dataBase64: req.screenshot.dataBase64 });
    content.push({ type: 'text', text: 'Current screen (may show the problem being discussed)' });
  }
  const concepts = c.concepts.length ? c.concepts.map((x) => `${x.name} (${x.status})`).join('; ') : '(none yet)';
  const prior = c.priorLessonSummaries.length
    ? c.priorLessonSummaries.map((p) => `- ${p.date}: ${p.summary}`).join('\n')
    : '(none)';
  const transcript = truncateToChars(formatTranscript(req.transcript), 12000) || '(no speech transcribed yet)';
  content.push({
    type: 'text',
    text: `## Context
Student: ${c.studentName}
Subject: ${c.subject ?? 'unknown'}
Running summary: ${c.runningSummary || '(none yet)'}
Concepts: ${concepts}
Prior lessons:
${prior}${c.priorContext ? `\nNotes from past lessons:\n${c.priorContext}` : ''}

## Recent transcript
${transcript}

Respond with the JSON object now.`,
  });
  return { system: HELPME_SYSTEM, content };
}

function extractJson(text: string): Record<string, unknown> | undefined {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return undefined;
  try {
    const v = JSON.parse(text.slice(a, b + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v).trim());
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

export function parseHelpMeResponse(text: string, nowMs: number): HelpMeResponse {
  const j = extractJson(text);
  const answer = j ? str(j.answer) : '';
  if (!j || !answer) {
    return {
      answer: text.trim() || 'The model returned an empty answer. Press Retry.',
      confidence: 'Unknown - model did not return structured output',
      overview: '',
      connections: [],
      updatedRunningSummary: '',
      createdAt: nowMs,
    };
  }
  const sources: ConnectionSource[] = ['this-lesson', 'past-lesson', 'new'];
  const connections: ConnectionItem[] = (Array.isArray(j.connections) ? j.connections : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      concept: str(x.concept),
      relation: str(x.relation),
      source: sources.includes(x.source as ConnectionSource) ? (x.source as ConnectionSource) : 'new',
    }))
    .filter((x) => x.concept);
  return {
    answer,
    confidence: str(j.confidence) || 'Unknown',
    overview: str(j.overview),
    connections,
    updatedRunningSummary: str(j.updatedRunningSummary),
    createdAt: nowMs,
  };
}

export const REPORT_SYSTEM = `You write end-of-lesson reports for a tutor. You receive the full lesson transcript (Tutor and Student) and the student's prior concept memory.
Respond ONLY with a JSON object (no prose, no code fences):
{"overview": string, "learned": string[], "yetToLearn": string[], "struggles": string[], "nextSteps": string[], "concepts": [{"name": string, "description": string, "status": "introduced" | "practiced" | "mastered" | "struggling"}], "lessonSummary": string}
- overview: short paragraph. learned: what the student learned. yetToLearn: topics not yet covered or not yet understood. struggles: where they had difficulty. nextSteps: suggested actions for the next lesson.
- concepts: concepts touched in THIS lesson; reuse the exact names from the prior concepts when the same concept appears, and update their status from the latest evidence.
- lessonSummary: 1-3 sentences for long-term memory.`;

export function buildReportPrompt(input: {
  lesson: Lesson; student: Student; transcript: TranscriptSegment[]; priorMemory: StudentMemory; priorContext?: string;
}): { system: string; content: LlmContentBlock[] } {
  const { lesson, student, priorMemory } = input;
  const concepts = priorMemory.concepts.length
    ? priorMemory.concepts.map((c) => `- ${c.name} (${c.status}): ${c.description}`).join('\n')
    : '(none)';
  const prior = priorMemory.lessonSummaries.length
    ? priorMemory.lessonSummaries.map((p) => `- ${p.date}: ${p.summary}`).join('\n')
    : '(none)';
  const transcript = truncateToChars(formatTranscript(input.transcript), 60000) || '(empty transcript)';
  return {
    system: REPORT_SYSTEM,
    content: [{
      type: 'text',
      text: `Student: ${student.name}\nSubject: ${lesson.subject ?? 'unknown'}\nLesson started: ${lesson.startedAt}${lesson.endedAt ? `\nLesson ended: ${lesson.endedAt}` : ''}\n\n## Prior concepts\n${concepts}\n\n## Prior lesson summaries\n${prior}${input.priorContext ? `\n\n## Notes from past lessons\n${input.priorContext}` : ''}\n\n## Transcript\n${transcript}\n\nRespond with the JSON object now.`,
    }],
  };
}

export function fallbackReport(): LessonReport {
  return { overview: 'Report generation failed; transcript saved.', learned: [], yetToLearn: [], struggles: [], nextSteps: [], concepts: [], lessonSummary: '' };
}

export function parseReport(text: string, lessonId: string): LessonReport {
  const j = extractJson(text);
  if (!j) return fallbackReport();
  const statuses: ConceptStatus[] = ['introduced', 'practiced', 'mastered', 'struggling'];
  const concepts: Concept[] = (Array.isArray(j.concepts) ? j.concepts : [])
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      name: str(x.name),
      description: str(x.description),
      status: statuses.includes(x.status as ConceptStatus) ? (x.status as ConceptStatus) : 'introduced',
      firstLessonId: lessonId,
      lastLessonId: lessonId,
    }))
    .filter((c) => c.name);
  const overview = str(j.overview);
  if (!overview && !Array.isArray(j.learned)) return fallbackReport();
  return {
    overview: overview || 'No overview provided.',
    learned: strArr(j.learned),
    yetToLearn: strArr(j.yetToLearn),
    struggles: strArr(j.struggles),
    nextSteps: strArr(j.nextSteps),
    concepts,
    lessonSummary: str(j.lessonSummary),
  };
}

/** Extracts the (possibly incomplete) value of the "answer" string field from streamed JSON text. */
export function extractPartialAnswer(raw: string): string {
  const m = /"answer"\s*:\s*"/.exec(raw);
  if (!m) return '';
  let out = '';
  for (let i = m.index + m[0].length; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') break;
    if (c !== '\\') { out += c; continue; }
    const n = raw[i + 1];
    if (n === undefined) break;
    if (n === 'u') {
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16)); i += 5; continue;
    }
    out += n === 'n' ? '\n' : n === 't' ? '\t' : n === 'r' ? '\r' : n;
    i++;
  }
  return out;
}
