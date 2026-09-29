/**
 * Chapter boundaries at character level. Pure, unit-tested.
 *
 * Bookmarks, printed tables of contents and detected headings only say on
 * which page a chapter starts, and a new chapter often starts in the middle of
 * a page. Each heading is therefore looked up in the cleaned text of its start
 * page: the occurrence that best fits the heading's vertical position (from the
 * bookmark destination, if known) and that starts a sentence wins. Without a
 * match the chapter starts at a sentence boundary near the expected position,
 * or at the top of the page.
 *
 * The resulting offsets cut the text into segments; windows never cross a
 * segment boundary, so every window belongs to exactly one chapter.
 */
import type { Outline, OutlineNode } from './outline';
import type { Page } from './types';
import type { JoinedText } from './windows';

export interface ChapterStart {
  /** Offset in the joined cleaned text of the PDF. */
  charStart: number;
  /** Titles from the root to this node. */
  path: string[];
  /** Id of the outline node. */
  nodeId: string;
  /** How the offset was found: the heading text, its position on the page, or only the page. */
  how: 'text' | 'position' | 'page';
}

/** Lower case, letters and digits only, words separated by one space; `map[i]` = index in the original. */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let space = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/[\p{L}\p{N}]/u.test(c)) {
      for (const lc of c.toLowerCase()) {
        norm += lc;
        map.push(i);
      }
      space = false;
    } else if (!space) {
      norm += ' ';
      map.push(i);
      space = true;
    }
  }
  return { norm: norm.trimEnd(), map };
}

/** Title variants to look for, most specific first: full title, without numbering, first words. */
export function titleVariants(title: string): string[] {
  const full = normalizeWithMap(title).norm;
  const unnumbered = full.replace(/^(?:(?:kapitel|chapter|teil|part|abschnitt|section)\s+)?(?:[0-9]+(?:\s[0-9]+)*|[ivxlc]+)\s+/, '');
  const words = unnumbered.split(' ');
  const out = [full, unnumbered, words.slice(0, 4).join(' ')];
  return Array.from(new Set(out.filter((v) => v.length >= 4)));
}

const SENTENCE_END = /[.!?:;…"'»”)\]]\s*$/;

/**
 * Offset of the heading `title` in `pageText`, or null. Among several
 * occurrences the one after a sentence end (or at the top) and closest to
 * `top` (0..1 down the page) wins.
 */
export function findHeading(pageText: string, title: string, top: number | null): number | null {
  const { norm, map } = normalizeWithMap(pageText);
  for (const variant of titleVariants(title)) {
    const hits: number[] = [];
    for (let at = norm.indexOf(variant); at >= 0; at = norm.indexOf(variant, at + 1)) {
      const before = at === 0 || norm[at - 1] === ' ';
      const after = at + variant.length >= norm.length || norm[at + variant.length] === ' ';
      if (before && after) hits.push(map[at]);
    }
    if (!hits.length) continue;
    const expected = top === null ? 0 : top * pageText.length;
    const score = (offset: number) => {
      const boundary = offset === 0 || SENTENCE_END.test(pageText.slice(Math.max(0, offset - 3), offset));
      return Math.abs(offset - expected) / Math.max(1, pageText.length) + (boundary ? 0 : 0.5);
    };
    return hits.reduce((best, h) => (score(h) < score(best) ? h : best));
  }
  return null;
}

/** Start of the sentence nearest to `offset` (a heading position without a text match). */
export function nearestSentenceStart(text: string, offset: number): number {
  const re = /[.!?…]\s+(?=\S)/g;
  let best = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index! + m[0].length;
    if (Math.abs(start - offset) < Math.abs(best - offset)) best = start;
    if (start > offset + 400) break;
  }
  return best;
}

function preorder(nodes: OutlineNode[], path: string[] = []): { node: OutlineNode; path: string[] }[] {
  return nodes.flatMap((n) => [{ node: n, path: [...path, n.title] }, ...preorder(n.children, [...path, n.title])]);
}

/**
 * Character offsets of all outline nodes in the joined cleaned text, in
 * document order and never decreasing. `pages` are the cleaned pages the
 * joined text was made of (skipped pages are missing: a chapter starting on a
 * skipped page starts at the next kept page).
 */
export function chapterStarts(outline: Outline, pages: Page[], joined: JoinedText): ChapterStart[] {
  if (outline.source === 'blocks' || !pages.length) return [];
  const out: ChapterStart[] = [];
  let last = 0;
  for (const { node, path } of preorder(outline.nodes)) {
    const idx = pages.findIndex((p) => p.pageNumber >= node.pageStart);
    if (idx < 0) continue;
    const page = pages[idx];
    let offset = 0;
    let how: ChapterStart['how'] = 'page';
    if (page.pageNumber === node.pageStart) {
      const found = findHeading(page.text, node.title, node.top);
      if (found !== null) {
        offset = found;
        how = 'text';
      } else if (node.top !== null && node.top > 0.05) {
        offset = nearestSentenceStart(page.text, node.top * page.text.length);
        how = 'position';
      }
    }
    const charStart = Math.max(last, joined.starts[idx] + offset);
    last = charStart;
    out.push({ charStart, path, nodeId: node.id, how });
  }
  return out;
}

/** Chapter path of a text offset: the last start at or before it (deepest node when several share a spot). */
export function pathAt(starts: ChapterStart[], offset: number): string[] {
  let path: string[] = [];
  for (const s of starts) {
    if (s.charStart > offset) break;
    path = s.path;
  }
  return path;
}
