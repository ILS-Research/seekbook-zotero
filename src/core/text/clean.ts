/**
 * Page cleanup before windowing: running headers/footers, table-of-contents
 * pages and (nearly) empty pages. Pure, unit-tested.
 *
 * Zotero's PDF worker joins lines of the same font into running text, so a
 * running header is often not a line of its own but the first words of the
 * page ("User documentation for JIRA 7.1 12 Getting help …"). Headers and
 * footers are therefore found as word prefixes/suffixes that recur on many pages
 * once digits are masked (page numbers differ from page to page).
 */
import type { Page } from './types';

export interface CleanResult {
  /** Pages that go into the index, cleaned; skipped pages are left out. */
  pages: Page[];
  /** Removed header/footer patterns (digits shown as #), for reports. */
  removed: string[];
  /** Physical page numbers skipped as table of contents. */
  tocPages: number[];
  /** Physical page numbers skipped as empty or nearly empty. */
  emptyPages: number[];
  /** All pages with headers/footers removed (also the skipped ones), for page lookups. */
  stripped: Page[];
}

/** Share of pages a prefix/suffix must start/end to count as running header/footer. */
export const HEADER_SHARE = 0.3;
const MAX_WORDS = 14;
/** Pages with fewer words than this are skipped (title pages, blank pages, figure-only pages). */
export const MIN_PAGE_WORDS = 8;

function normWord(w: string): string {
  return w.toLowerCase().replace(/\d+/g, '#');
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Share of the best prefix count a longer prefix must keep to count as part of the header. */
const EXTEND_SHARE = 0.8;

/**
 * Word sequence at the start (or end, if `fromEnd`) that recurs on at least
 * `minPages` pages. Among the most frequent sequences the longest one wins
 * that still covers ≥ 80 % of those pages, so a header does not swallow a
 * body word that happens to follow it on a few pages. A single word only
 * counts if it is a bare (page) number.
 */
function findRunning(pageWords: string[][], fromEnd: boolean, minPages: number): string[] | null {
  const best: ({ key: string[]; count: number } | null)[] = [];
  for (let k = 1; k <= MAX_WORDS; k++) {
    const counts = new Map<string, number>();
    for (const ws of pageWords) {
      if (ws.length < k + MIN_PAGE_WORDS / 2) continue;
      const part = fromEnd ? ws.slice(ws.length - k) : ws.slice(0, k);
      const key = part.map(normWord).join(' ');
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let top: { key: string[]; count: number } | null = null;
    for (const [key, count] of counts) {
      if (count < minPages) continue;
      if (k === 1 && !/^[#ivxlc]+$/.test(key)) continue;
      if (!top || count > top.count) top = { key: key.split(' '), count };
    }
    best.push(top);
  }
  const ref = Math.max(0, ...best.map((b) => b?.count || 0));
  if (!ref) return null;
  for (let k = best.length - 1; k >= 0; k--) {
    if (best[k] && best[k]!.count >= ref * EXTEND_SHARE) return best[k]!.key;
  }
  return null;
}

function matches(ws: string[], key: string[], fromEnd: boolean): boolean {
  if (ws.length < key.length) return false;
  const part = fromEnd ? ws.slice(ws.length - key.length) : ws.slice(0, key.length);
  return part.every((w, i) => normWord(w) === key[i]);
}

/** Removes running headers and footers; returns the patterns found. */
export function stripRunningLines(pages: Page[], share = HEADER_SHARE): { pages: Page[]; removed: string[] } {
  const minPages = Math.max(3, Math.ceil(pages.length * share));
  let pageWords = pages.map((p) => words(p.text));
  const removed: string[] = [];
  if (pages.length >= 3) {
    // Several rounds: a header is often "title" plus "page number", odd and even pages differ.
    for (const fromEnd of [false, true]) {
      for (let round = 0; round < 4; round++) {
        const key = findRunning(pageWords, fromEnd, minPages);
        if (!key) break;
        removed.push(`${fromEnd ? 'footer' : 'header'}: ${key.join(' ')}`);
        pageWords = pageWords.map((ws) => {
          if (!matches(ws, key, fromEnd)) return ws;
          return fromEnd ? ws.slice(0, ws.length - key.length) : ws.slice(key.length);
        });
      }
    }
  }
  if (!removed.length) return { pages, removed };
  // Rebuild the text from the remaining words; line breaks inside a page carry no meaning after the PDF worker.
  return { pages: pages.map((p, i) => ({ pageNumber: p.pageNumber, text: pageWords[i].join(' ') })), removed };
}

// "Methoden ........ 45", "3.2 Stichprobe . . . . 67", "Einleitung … 3"
const DOT_LEADER = /(?:\.\s?){4,}\s*\d{1,4}\b|…\s*\d{1,4}\b/g;
const TOC_HEADING = /^\s*(?:inhaltsverzeichnis|inhalt|table of contents|contents|sommaire)\b/i;

export interface TocEntry {
  title: string;
  /** Printed page as it appears in the table of contents (label, not physical page). */
  label: string;
}

/** Entries "Title …… 45" of a table-of-contents page. */
export function parseTocEntries(text: string): TocEntry[] {
  const out: TocEntry[] = [];
  const re = /([^\n.…]{3,120}?)\s*(?:(?:\.\s?){2,}|…+)\s*(\d{1,4}|[ivxlc]{1,6})\b/gi;
  for (const m of text.matchAll(re)) {
    const title = m[1].replace(/^\s*\d{1,4}(?=\s+\d)/, '').trim();
    if (title.length >= 3) out.push({ title, label: m[2] });
  }
  if (out.length) return out;
  // Without dot leaders: one entry per line, page number at the end.
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(.{3,100}?)\s+(\d{1,4})$/);
    if (m && /\p{L}{3}/u.test(m[1])) out.push({ title: m[1].trim(), label: m[2] });
  }
  return out;
}

/** True for a table-of-contents page: many dot leaders, or a contents heading plus numbered lines. */
export function isTocPage(text: string): boolean {
  const leaders = (text.match(DOT_LEADER) || []).length;
  if (leaders >= 5) return true;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /\p{L}{3}.*\s\d{1,4}$/u.test(l)).length;
  if (lines.length >= 6 && numbered / lines.length >= 0.6) return true;
  return TOC_HEADING.test(text) && (leaders >= 2 || numbered >= 4);
}

/**
 * Full cleanup: headers/footers off, TOC pages and nearly empty pages skipped.
 * TOC pages are only looked for in the first 15 % of the document (and at least
 * the first 20 pages), so an index at the back or number-heavy tables stay.
 */
export function cleanPages(pages: Page[]): CleanResult {
  const { pages: stripped, removed } = stripRunningLines(pages);
  const tocLimit = Math.max(20, Math.ceil(pages.length * 0.15));
  const tocPages: number[] = [];
  const emptyPages: number[] = [];
  const kept: Page[] = [];
  stripped.forEach((p, i) => {
    // TOC detection on the original text: the PDF worker's line breaks help there.
    if (p.pageNumber <= tocLimit && isTocPage(pages[i].text)) tocPages.push(p.pageNumber);
    else if (words(p.text).length < MIN_PAGE_WORDS) emptyPages.push(p.pageNumber);
    else kept.push(p);
  });
  return { pages: kept, removed, tocPages, emptyPages, stripped };
}
