/** Pure Whisper hallucination filter. Returns '' when the text should be dropped. */
const DROP_EXACT = new Set(
  [
    'thank you', 'thanks', 'thank you very much', 'thanks for watching', 'thank you for watching',
    'please subscribe', 'subscribe', 'you', 'uh', 'um', 'hmm',
  ],
);

export function cleanTranscriptText(text: string): string {
  let t = (text ?? '')
    // [BLANK_AUDIO], [MUSIC], (silence), (upbeat music), *laughs* ... but keep maths like (x + 2)
    .replace(/\[[^\]]*\]|\([A-Za-z][A-Za-z ]{2,}\)|\*[A-Za-z ]+\*|♪+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  // Collapse a sentence repeated back-to-back ("Thank you. Thank you. Thank you.") to a single copy.
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean); // split only at sentence-final punctuation
  const dedup = sentences.filter((s, i) => i === 0 || s.toLowerCase() !== sentences[i - 1].toLowerCase());
  if (dedup.length < sentences.length) t = dedup.join(' ');
  const norm = t.toLowerCase().replace(/[^a-z' ]/g, '').trim();
  if (!norm || DROP_EXACT.has(norm)) return '';
  return t;
}
