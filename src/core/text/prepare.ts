/**
 * From the page texts of one PDF to index-ready windows, and the book-level
 * steps across PDFs (order, duplicates). Pure, unit-tested; the Zotero side
 * (reading files, storing rows) lives in indexer.ts.
 */
import { cleanPages } from './clean';
import { buildOutline, chapterPathAt, type Outline, type ReaderOutlineItem } from './outline';
import type { Page } from './types';
import { makeWindows, normalizedWords, type TextWindow } from './windows';

export interface PreparedWindow extends TextWindow {
  /** Chapter path "Chapter › Section", '' if unknown (or only page blocks). */
  chapter: string;
}

export interface PreparedDocument {
  pages: number;
  outline: Outline;
  windows: PreparedWindow[];
  removed: string[];
  tocPages: number[];
  emptyPages: number[];
  /** All pages without running headers/footers (for /seekbook/pages). */
  stripped: Page[];
}

export const CHAPTER_SEPARATOR = ' › ';

export interface PrepareOptions {
  chunkWords?: number;
  strideWords?: number;
  bookmarks?: ReaderOutlineItem[] | null;
  labels?: (string | null)[] | null;
  /** Attachment title, put in front of chapter paths when the book has several PDFs. */
  docTitle?: string;
}

export class NoTextError extends Error {
  constructor() {
    super('The PDF contains no text (scanned?); OCR needed');
    this.name = 'NoTextError';
  }
}

export function prepareDocument(rawPages: Page[], opts: PrepareOptions = {}): PreparedDocument {
  if (!rawPages.some((p) => p.text.trim())) throw new NoTextError();
  const clean = cleanPages(rawPages);
  const tocSet = new Set(clean.tocPages);
  const outline = buildOutline(rawPages, opts.bookmarks, {
    pages: rawPages.filter((p) => tocSet.has(p.pageNumber)),
    labels: opts.labels,
  });
  const windows = makeWindows(clean.pages, opts.chunkWords, opts.strideWords).map((w) => {
    const path = outline.source === 'blocks' ? [] : chapterPathAt(outline, w.pageStart);
    if (opts.docTitle && (path.length || outline.source === 'blocks')) path.unshift(opts.docTitle);
    return { ...w, chapter: path.join(CHAPTER_SEPARATOR) };
  });
  return {
    pages: rawPages.length,
    outline,
    windows,
    removed: clean.removed,
    tocPages: clean.tocPages,
    emptyPages: clean.emptyPages,
    stripped: clean.stripped,
  };
}

/** Text sent to the embedding model for one window. */
export function embeddingText(bookTitle: string, chapter: string, text: string, docPrefix = ''): string {
  const head = [bookTitle, chapter].filter(Boolean).join(' — ');
  return `${docPrefix}${head ? head + '\n' : ''}${text}`;
}

// "Kapitel 3", "Kap. 10", "Chapter 2", "Teil II", "Part 1", "Band 2", "03 - Methoden", "3_Methoden"
const LEADING_NUMBER = /^\s*(?:(?:kapitel|kap\.?|chapter|chap\.?|ch\.?|teil|part|band|vol\.?|volume|abschnitt|section)\s*)?([0-9]{1,3}|[ivxlc]{1,6})(?=[\s._\-–:)]|$)/i;

function romanValue(s: string): number {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  const lower = s.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const cur = v[lower[i]];
    const next = v[lower[i + 1]] || 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

/** Chapter/part number at the start of a title or file name, or null. */
export function leadingNumber(title: string): number | null {
  const m = title.match(LEADING_NUMBER);
  if (!m) return null;
  return /^\d/.test(m[1]) ? Number(m[1]) : romanValue(m[1]);
}

export interface OrderInput {
  key: string;
  title: string;
  fileName: string;
  dateAdded: string;
}

/**
 * Reading order of a book's PDFs: by leading chapter/part number when both
 * have one, else natural order of title (then file name), else date added.
 */
export function orderDocuments<T extends OrderInput>(docs: T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const num = (d: T) => leadingNumber(d.title) ?? leadingNumber(d.fileName);
  return [...docs].sort((a, b) => {
    const na = num(a);
    const nb = num(b);
    if (na !== null && nb !== null && na !== nb) return na - nb;
    return collator.compare(a.title, b.title) || collator.compare(a.fileName, b.fileName)
      || a.dateAdded.localeCompare(b.dateAdded) || a.key.localeCompare(b.key);
  });
}

/** Share of a document's windows whose core (12 words from the middle) occurs in the other text. */
export function containment(partWindows: string[], wholeText: string, probeWords = 12): number {
  if (!partWindows.length) return 0;
  const whole = ` ${normalizedWords(wholeText).join(' ')} `;
  let found = 0;
  let probes = 0;
  for (const w of partWindows) {
    const ws = normalizedWords(w);
    if (ws.length < probeWords) continue;
    probes++;
    const from = Math.floor((ws.length - probeWords) / 2);
    if (whole.includes(` ${ws.slice(from, from + probeWords).join(' ')} `)) found++;
  }
  return probes ? found / probes : 0;
}

export const CONTAINED_SHARE = 0.8;

export interface DupInput {
  key: string;
  hash: string;
  /** Window texts (for the containment check). */
  windows: string[];
  /** Joined cleaned text. */
  text: string;
  words: number;
}

/**
 * Duplicates within one book: same content hash ⇒ the later one is a duplicate;
 * a PDF whose windows occur (≥ 80 %) in a larger PDF ⇒ the smaller one is a
 * duplicate of the larger (prefer 'whole'), or the larger one of the smaller
 * parts when all of its text is covered by parts (prefer 'parts').
 * Returns key → key of the PDF it duplicates.
 */
export function findDuplicates(docs: DupInput[], prefer: 'whole' | 'parts' = 'whole'): Map<string, string> {
  const dup = new Map<string, string>();
  const byHash = new Map<string, string>();
  for (const d of docs) {
    const first = byHash.get(d.hash);
    if (first) dup.set(d.key, first);
    else byHash.set(d.hash, d.key);
  }
  const live = docs.filter((d) => !dup.has(d.key)).sort((a, b) => b.words - a.words);
  for (let i = 0; i < live.length; i++) {
    const whole = live[i];
    if (dup.has(whole.key)) continue;
    const parts = live.slice(i + 1).filter((p) => !dup.has(p.key) && containment(p.windows, whole.text) >= CONTAINED_SHARE);
    if (!parts.length) continue;
    if (prefer === 'whole') {
      for (const p of parts) dup.set(p.key, whole.key);
    } else {
      // The whole PDF only goes if the parts cover it; otherwise the whole stays and the parts go.
      const covered = containment(whole.windows, parts.map((p) => p.text).join('\n'));
      if (covered >= CONTAINED_SHARE) dup.set(whole.key, parts[0].key);
      else for (const p of parts) dup.set(p.key, whole.key);
    }
  }
  return dup;
}
