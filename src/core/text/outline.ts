/**
 * Chapter tree of a PDF. Copied from SeekChat (src/core/context/outline.ts);
 * SeekBook adds the printed table of contents as a source.
 *
 * Source chain: 1. the PDF outline (bookmarks, read from the file),
 * 2. the printed table of contents ('toc', titles + printed pages mapped to
 * physical pages), 3. headings detected in the page text, 4. blocks of pages
 * (last resort; no chapter path goes into the embedding then). Pure, unit-tested.
 */
import { parseTocEntries, type TocEntry } from './clean';
import type { Page } from './types';

const UNTITLED = 'Untitled';

/** ~3.5 characters per token, as in SeekChat's fit.ts. */
function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.5);
}

export interface OutlineNode {
  id: string;
  title: string;
  /** 1-based, inclusive. */
  pageStart: number;
  pageEnd: number;
  tokens: number;
  children: OutlineNode[];
}

export type OutlineSource = 'pdf' | 'toc' | 'headings' | 'blocks';

export interface Outline {
  source: OutlineSource;
  nodes: OutlineNode[];
}

/** Item shape of the reader's outline state (pdf.js bookmarks as Zotero's reader stores them). */
export interface ReaderOutlineItem {
  title?: string;
  location?: { position?: { pageIndex?: number } };
  items?: ReaderOutlineItem[];
}

function tokensOf(pages: Page[], start: number, end: number): number {
  let chars = 0;
  for (const p of pages) if (p.pageNumber >= start && p.pageNumber <= end) chars += p.text.length;
  return estimateTokens(chars);
}

/**
 * Builds nodes from a list of (title, start page) entries: each entry ends
 * where the next one at the same or a higher level begins.
 */
function fromEntries(
  entries: { title: string; page: number; children: { title: string; page: number }[] }[],
  pages: Page[],
  lastPage: number,
): OutlineNode[] {
  const sorted = entries.filter((e) => e.page >= 1).sort((a, b) => a.page - b.page);
  return sorted.map((e, i) => {
    const end = i + 1 < sorted.length ? Math.max(e.page, sorted[i + 1].page - 1) : lastPage;
    const kids = e.children.filter((c) => c.page >= e.page && c.page <= end).sort((a, b) => a.page - b.page);
    const children = kids.map((c, j) => {
      const cEnd = j + 1 < kids.length ? Math.max(c.page, kids[j + 1].page - 1) : end;
      return { id: `${i}.${j}`, title: c.title, pageStart: c.page, pageEnd: cEnd, tokens: tokensOf(pages, c.page, cEnd), children: [] };
    });
    return { id: `${i}`, title: e.title, pageStart: e.page, pageEnd: end, tokens: tokensOf(pages, e.page, end), children };
  });
}

export function outlineFromReader(items: ReaderOutlineItem[] | null | undefined, pages: Page[]): Outline | null {
  // Many manuals have one root entry (the document title) holding all chapters:
  // show the chapters instead of a single box covering the whole document.
  while (items?.length === 1 && items[0].items?.length) items = items[0].items;
  if (!items?.length) return null;
  const page = (it: ReaderOutlineItem) => (it.location?.position?.pageIndex ?? -1) + 1;
  const entries = items
    .map((it) => ({
      title: (it.title || '').trim() || `(${UNTITLED})`,
      page: page(it),
      children: (it.items || []).map((c) => ({ title: (c.title || '').trim() || `(${UNTITLED})`, page: page(c) })),
    }))
    .filter((e) => e.page >= 1);
  if (!entries.length) return null;
  return { source: 'pdf', nodes: fromEntries(entries, pages, pages.length) };
}

// "Kapitel 3", "Chapter 2: ...", "Teil II", "3 Methoden", "4.2 Ergebnisse"
const HEADING_LINE = /^(?:(?:Kapitel|Chapter|Teil|Part|Abschnitt|Section)\s+[\dIVXLC]+\b.*|\d{1,2}(?:\.\d{1,2})?\.?\s+\p{Lu}[\p{L}\- ,:]{2,60})$/u;
// Zotero's PDF worker joins lines of the same font into running text, so a
// heading often only shows as the start of the page: keyword + number + a few words.
const HEADING_START = /^(?:Kapitel|Chapter|Teil|Part|Abschnitt|Section)\s+[\dIVXLC]+\b[:.]?(?:\s+\p{Lu}[\p{L}\-]*){1,4}/u;
const NUMBERED_START = /^\d{1,2}(?:\.\d{1,2})?\.?\s+\p{Lu}[\p{L}\-]+(?:\s+\p{Ll}{0,3}\s*\p{Lu}[\p{L}\-]+)?/u;

const SENTENCE_START = new Set((
  'der die das den dem des ein eine einer eines dieser diese dieses in im am an auf aus bei mit nach von vor zu zur zum ' +
  'es er sie wir ich man hier dabei damit dazu daher so wie wenn als um für ' +
  'the a an this these that in on at for with from to we it as'
).split(' '));

/** A heading at the top of a page, or null. */
export function detectHeading(pageText: string): string | null {
  const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean);
  // A heading on its own line only counts if the page has lines at all, not one run of text.
  const line = lines.length > 1 ? lines.slice(0, 3).find((l) => l.length <= 80 && HEADING_LINE.test(l)) : undefined;
  if (line) return line;
  const start = pageText.trim().slice(0, 120);
  const m = start.match(HEADING_START) || start.match(NUMBERED_START);
  if (!m) return null;
  // Running text: the heading ends before the first word that typically starts a sentence.
  // German capitalizes nouns, so capitalization alone cannot tell heading from text.
  const words = m[0].trim().split(/\s+/);
  const firstTitleWord = /^\d/.test(words[0]) ? 1 : 2;
  let end = words.length;
  for (let i = firstTitleWord + 1; i < words.length; i++) {
    if (SENTENCE_START.has(words[i].toLowerCase())) {
      end = i;
      break;
    }
  }
  return words.slice(0, Math.min(end, firstTitleWord + 4)).join(' ');
}

export function outlineFromHeadings(pages: Page[]): Outline | null {
  const found: { title: string; page: number; sub: boolean }[] = [];
  for (const p of pages) {
    const heading = detectHeading(p.text);
    if (heading) found.push({ title: heading, page: p.pageNumber, sub: /^\d{1,2}\.\d/.test(heading) });
  }
  if (found.filter((f) => !f.sub).length < 2) return null;
  const entries: { title: string; page: number; children: { title: string; page: number }[] }[] = [];
  for (const f of found) {
    if (!f.sub || !entries.length) entries.push({ title: f.title, page: f.page, children: [] });
    else entries[entries.length - 1].children.push({ title: f.title, page: f.page });
  }
  if (entries[0].page > 1) entries.unshift({ title: 'Front matter', page: 1, children: [] });
  return { source: 'headings', nodes: fromEntries(entries, pages, pages.length) };
}

export function outlineFromBlocks(pages: Page[], blockSize = 20): Outline {
  const nodes: OutlineNode[] = [];
  for (let start = 1, i = 0; start <= pages.length; start += blockSize, i++) {
    const end = Math.min(pages.length, start + blockSize - 1);
    nodes.push({ id: `${i}`, title: `Pages ${start}–${end}`, pageStart: start, pageEnd: end, tokens: tokensOf(pages, start, end), children: [] });
  }
  return { source: 'blocks', nodes };
}

/**
 * Outline from the printed table of contents: each entry's printed page is
 * mapped to a physical page through the PDF's page labels, or, without labels,
 * through the most common offset between printed page and the page whose text
 * starts with the entry's title.
 */
export function outlineFromToc(
  tocPages: Page[], pages: Page[], labels?: (string | null)[] | null,
): Outline | null {
  const entries: TocEntry[] = tocPages.flatMap((p) => parseTocEntries(p.text));
  if (entries.length < 3) return null;
  const byLabel = new Map<string, number>();
  labels?.forEach((l, i) => { if (l && !byLabel.has(l.toLowerCase())) byLabel.set(l.toLowerCase(), i + 1); });
  const lastToc = Math.max(0, ...tocPages.map((p) => p.pageNumber));
  let offset: number | null = null;
  if (!byLabel.size) {
    const votes = new Map<number, number>();
    for (const e of entries) {
      const printed = Number(e.label);
      if (!Number.isFinite(printed)) continue;
      const needle = e.title.toLowerCase().slice(0, 40);
      const hit = pages.find((p) => p.pageNumber > lastToc && p.text.slice(0, 300).toLowerCase().includes(needle));
      if (hit) votes.set(hit.pageNumber - printed, (votes.get(hit.pageNumber - printed) || 0) + 1);
    }
    const best = [...votes].sort((a, b) => b[1] - a[1])[0];
    offset = best ? best[0] : 0;
  }
  const mapped = entries
    .map((e) => {
      const page = byLabel.size ? byLabel.get(e.label.toLowerCase()) ?? -1 : Number(e.label) + (offset ?? 0);
      return { title: e.title, page, sub: /^\d{1,2}\.\d/.test(e.title) };
    })
    .filter((e) => Number.isFinite(e.page) && e.page > lastToc && e.page <= pages.length);
  if (mapped.filter((e) => !e.sub).length < 2) return null;
  const top: { title: string; page: number; children: { title: string; page: number }[] }[] = [];
  for (const e of mapped) {
    if (!e.sub || !top.length) top.push({ title: e.title, page: e.page, children: [] });
    else top[top.length - 1].children.push({ title: e.title, page: e.page });
  }
  return { source: 'toc', nodes: fromEntries(top, pages, pages.length) };
}

export function buildOutline(
  pages: Page[], readerItems?: ReaderOutlineItem[] | null,
  toc?: { pages: Page[]; labels?: (string | null)[] | null },
): Outline {
  return outlineFromReader(readerItems, pages)
    || (toc && outlineFromToc(toc.pages, pages, toc.labels))
    || outlineFromHeadings(pages)
    || outlineFromBlocks(pages);
}

/** Flat rows for the outline table; parent '' for top-level nodes. */
export function flattenOutline(outline: Outline): { id: string; parent: string; title: string; pageStart: number; pageEnd: number; depth: number }[] {
  const out: { id: string; parent: string; title: string; pageStart: number; pageEnd: number; depth: number }[] = [];
  const walk = (nodes: OutlineNode[], parent: string, depth: number) => {
    for (const n of nodes) {
      out.push({ id: n.id, parent, title: n.title, pageStart: n.pageStart, pageEnd: n.pageEnd, depth });
      walk(n.children, n.id, depth + 1);
    }
  };
  walk(outline.nodes, '', 0);
  return out;
}

/** Titles from the root to the deepest node containing `page`; [] if none. */
export function chapterPathAt(outline: Outline, page: number): string[] {
  const path: string[] = [];
  let nodes = outline.nodes;
  for (;;) {
    const hit = nodes.find((n) => n.pageStart <= page && page <= n.pageEnd);
    if (!hit) return path;
    path.push(hit.title);
    nodes = hit.children;
  }
}
