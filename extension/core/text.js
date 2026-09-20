// Inspired by Needle's sentence-offset approach (Apache-2.0).
// Modified for CJK text, bounded choices, and long-passage splitting.
const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });

export const LIMITS = Object.freeze({ query: 400, blocks: 160, blockChars: 1800, totalChars: 60000 });

export function sentenceSpans(text) {
  const spans = Array.from(segmenter.segment(text), ({ segment, index }) => {
    const start = index + segment.length - segment.trimStart().length;
    const end = index + segment.trimEnd().length;
    return { start, end, text: text.slice(start, end) };
  }).filter(({ start, end }) => end > start);
  // Jev allows at most 255 choices. Group pathological punctuation-heavy text.
  const stride = Math.ceil(spans.length / 120);
  if (stride <= 1) return spans;
  const grouped = [];
  for (let i = 0; i < spans.length; i += stride) {
    const start = spans[i].start;
    const end = spans[Math.min(i + stride, spans.length) - 1].end;
    grouped.push({ start, end, text: text.slice(start, end) });
  }
  return grouped;
}

export function splitTextSpans(text, maxLength = LIMITS.blockChars) {
  const spans = [];
  let offset = 0;
  while (offset < text.length) {
    while (/\s/u.test(text[offset] || "") && offset < text.length) offset++;
    if (offset >= text.length) break;
    let end = Math.min(offset + maxLength, text.length);
    if (end < text.length) {
      const candidate = text.slice(offset, end);
      const boundaries = [...candidate.matchAll(/[。！？.!?;；\n]\s*|\s+/gu)];
      const last = boundaries.at(-1);
      if (last && last.index > maxLength / 2) end = offset + last.index + last[0].length;
      // Do not split a UTF-16 surrogate pair.
      const code = text.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end--;
    }
    const trimmedEnd = offset + text.slice(offset, end).trimEnd().length;
    if (trimmedEnd > offset) spans.push({ start: offset, end: trimmedEnd, text: text.slice(offset, trimmedEnd) });
    offset = end;
  }
  return spans;
}
