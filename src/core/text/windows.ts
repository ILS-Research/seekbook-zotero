/**
 * Overlapping word windows over the cleaned text of one PDF. Pure, unit-tested.
 *
 * The PDF worker loses paragraph breaks, so windows are counted in words:
 * `chunkWords` long, a new one every `strideWords`. Start and end are pulled
 * to the nearest sentence boundary within ±20 words. Windows cross page breaks;
 * page_start/page_end come from character positions in the joined text.
 */
import type { Page } from './types';

export interface TextWindow {
  idx: number;
  pageStart: number;
  pageEnd: number;
  /** Character range in the joined cleaned text of the PDF. */
  charStart: number;
  charEnd: number;
  text: string;
}

export interface JoinedText {
  text: string;
  /** Start offset of each page in `text`, same order as the pages. */
  starts: number[];
  pageNumbers: number[];
}

export const SNAP_WORDS = 20;
const PAGE_SEPARATOR = '\n\n';

export function joinPages(pages: Page[]): JoinedText {
  const starts: number[] = [];
  let text = '';
  for (const p of pages) {
    if (text) text += PAGE_SEPARATOR;
    starts.push(text.length);
    text += p.text;
  }
  return { text, starts, pageNumbers: pages.map((p) => p.pageNumber) };
}

/** Physical page of a character offset (binary search over page starts). */
export function pageAt(joined: JoinedText, offset: number): number {
  let lo = 0;
  let hi = joined.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (joined.starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return joined.pageNumbers[lo] ?? 1;
}

const SENTENCE_END = /[.!?…:;]["'»«“”)\]]*$/;

/**
 * Index in [from, to] closest to `target` such that a sentence starts at word i
 * (word i-1 ends a sentence); `target` if there is none.
 */
function snapStart(words: string[], target: number, from: number, to: number): number {
  for (let d = 0; d <= SNAP_WORDS; d++) {
    for (const i of [target - d, target + d]) {
      if (i < from || i > to) continue;
      if (i === 0 || SENTENCE_END.test(words[i - 1])) return i;
    }
  }
  return target;
}

/** Exclusive end index closest to `target` such that word end-1 ends a sentence; `target` if none. */
function snapEnd(words: string[], target: number, from: number, to: number): number {
  for (let d = 0; d <= SNAP_WORDS; d++) {
    for (const i of [target + d, target - d]) {
      if (i < from || i > to) continue;
      if (i === words.length || SENTENCE_END.test(words[i - 1])) return i;
    }
  }
  return target;
}

export function makeWindows(pages: Page[], chunkWords = 200, strideWords = 120): TextWindow[] {
  const joined = joinPages(pages);
  const positions: { start: number; end: number }[] = [];
  const words: string[] = [];
  for (const m of joined.text.matchAll(/\S+/g)) {
    words.push(m[0]);
    positions.push({ start: m.index!, end: m.index! + m[0].length });
  }
  const n = words.length;
  const out: TextWindow[] = [];
  if (!n) return out;
  const stride = Math.max(1, Math.min(strideWords, chunkWords));
  let start = 0;
  for (;;) {
    const minEnd = Math.min(n, start + Math.ceil(chunkWords / 2));
    const end = start + chunkWords >= n ? n : snapEnd(words, start + chunkWords, minEnd, n);
    const charStart = positions[start].start;
    const charEnd = positions[end - 1].end;
    out.push({
      idx: out.length,
      pageStart: pageAt(joined, charStart),
      pageEnd: pageAt(joined, charEnd - 1),
      charStart,
      charEnd,
      text: words.slice(start, end).join(' '),
    });
    if (end >= n) break;
    // Next start: after this start (progress), no later than this end (no gaps).
    const to = Math.min(end, n - 1);
    start = snapStart(words, Math.min(start + stride, to), start + 1, to);
  }
  return out;
}

/** Normalized word sequence for comparing texts of different PDFs (case, punctuation, hyphenation ignored). */
export function normalizedWords(text: string): string[] {
  return (text.toLowerCase().replace(/-\s+/g, '').match(/[\p{L}\p{N}]+/gu) || []);
}
