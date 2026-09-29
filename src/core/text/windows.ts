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
      if (i === to || SENTENCE_END.test(words[i - 1])) return i;
    }
  }
  return target;
}

/** Segments shorter than this (a heading on its own) are merged into the next one. */
export const MIN_SEGMENT_WORDS = 30;

export interface SegmentedWindow extends TextWindow {
  /** Index of the segment (chapter part) the window lies in. */
  segment: number;
  /** Character offset where that segment starts. */
  segmentStart: number;
}

/**
 * Windows over the joined text of `pages`. `boundaries` (character offsets, e.g.
 * chapter starts) cut the text into segments; no window crosses a boundary.
 * Within a segment: `chunkWords` long, a new window every `strideWords`, start
 * and end pulled to sentence boundaries.
 */
export function makeWindows(pages: Page[], chunkWords = 200, strideWords = 120, boundaries: number[] = []): SegmentedWindow[] {
  const joined = joinPages(pages);
  const positions: { start: number; end: number }[] = [];
  const words: string[] = [];
  for (const m of joined.text.matchAll(/\S+/g)) {
    words.push(m[0]);
    positions.push({ start: m.index!, end: m.index! + m[0].length });
  }
  const n = words.length;
  const out: SegmentedWindow[] = [];
  if (!n) return out;

  // Word index of each boundary, then segments [cut_i, cut_i+1); tiny ones join the next.
  const cuts = [0];
  let w = 0;
  for (const b of Array.from(new Set(boundaries)).sort((a, c) => a - c)) {
    while (w < n && positions[w].start < b) w++;
    if (w > cuts[cuts.length - 1] && w < n) cuts.push(w);
  }
  cuts.push(n);
  const segments: [number, number][] = [];
  let from = 0;
  for (let i = 1; i < cuts.length; i++) {
    const to = cuts[i];
    if (to - from < MIN_SEGMENT_WORDS && i < cuts.length - 1) continue;
    segments.push([from, to]);
    from = to;
  }
  // A short tail merges backwards instead.
  if (segments.length > 1 && segments[segments.length - 1][1] - segments[segments.length - 1][0] < MIN_SEGMENT_WORDS) {
    const tail = segments.pop()!;
    segments[segments.length - 1][1] = tail[1];
  }

  const stride = Math.max(1, Math.min(strideWords, chunkWords));
  segments.forEach(([segFrom, segTo], segment) => {
    let start = segFrom;
    for (;;) {
      const minEnd = Math.min(segTo, start + Math.ceil(chunkWords / 2));
      const end = start + chunkWords >= segTo ? segTo : snapEnd(words, start + chunkWords, minEnd, segTo);
      const charStart = positions[start].start;
      const charEnd = positions[end - 1].end;
      out.push({
        idx: out.length,
        pageStart: pageAt(joined, charStart),
        pageEnd: pageAt(joined, charEnd - 1),
        charStart,
        charEnd,
        text: words.slice(start, end).join(' '),
        segment,
        segmentStart: positions[segFrom].start,
      });
      if (end >= segTo) break;
      // Next start: after this start (progress), no later than this end (no gaps).
      const to = Math.min(end, segTo - 1);
      start = snapStart(words, Math.min(start + stride, to), start + 1, to);
    }
  });
  return out;
}

/** Normalized word sequence for comparing texts of different PDFs (case, punctuation, hyphenation ignored). */
export function normalizedWords(text: string): string[] {
  return (text.toLowerCase().replace(/-\s+/g, '').match(/[\p{L}\p{N}]+/gu) || []);
}
