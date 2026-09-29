/**
 * Indexing: which books and PDFs, in which order, and the persistent queue.
 *
 * The queue is the `status` column of `documents` (queued → indexing → ready |
 * failed | duplicate), so it survives a restart. One book at a time: all its
 * PDFs are read and compared first (duplicates), then the remaining ones are
 * embedded in batches and written in one transaction per PDF.
 */
import { embed, EmbeddingError } from './embed/client';
import { floatToBytes, int8ToBytes, normalize, quantize } from './embed/vectors';
import { scanPool } from './search';
import type { DocRow, Store } from './store';
import { readPdfStructure } from './text/pdf-outline';
import { flattenOutline } from './text/outline';
import {
  embeddingText, findDuplicates, NoTextError, orderDocuments, prepareDocument, type DupInput, type PreparedDocument,
} from './text/prepare';
import { termKeys } from './text/tokenize';
import type { Page } from './text/types';
import { libraryIDOf, libraryKeyOf } from './zotero-items';
import { readPrefs, type SeekBookPrefs } from '../prefs';
import { log, logError, logger } from '../util/log';

const L = logger('Indexer');

export interface Progress {
  /** book_pk and attachment key being worked on, null when idle. */
  bookPk: number | null;
  attachmentKey: string | null;
  running: boolean;
  paused: boolean;
  /** Book x of n in this run. */
  book: number;
  books: number;
  title: string;
  /** Windows embedded of the current PDF. */
  chunk: number;
  chunks: number;
  lastError: string | null;
}

/** Index configuration; a change invalidates all vectors. */
/**
 * Version of the text preparation. Raise it when windows or chapters come out
 * differently, so existing indexes are rebuilt (2: windows stop at chapter starts).
 */
export const LAYOUT_VERSION = 2;

export function indexConfig(p: SeekBookPrefs): string {
  return JSON.stringify({
    provider: p.provider, model: p.model, chunkWords: p.chunkWords, strideWords: p.strideWords, docPrefix: p.docPrefix,
    layout: LAYOUT_VERSION,
  });
}

export function modelId(p: SeekBookPrefs): string {
  return `${p.provider}:${p.model}`;
}

function hasTag(item: any, tag: string): boolean {
  return !!tag && (item.getTags?.() || []).some((t: any) => t.tag === tag);
}

function isPdf(att: any): boolean {
  return att.isPDFAttachment ? att.isPDFAttachment() : att.attachmentContentType === 'application/pdf';
}

function isFileAttachment(att: any): boolean {
  return att.isFileAttachment ? att.isFileAttachment() : att.attachmentLinkMode !== Zotero.Attachments.LINK_MODE_LINKED_URL;
}

async function fileHash(path: string): Promise<string> {
  try {
    const md5 = await Zotero.Utilities.Internal.md5Async(path);
    if (md5) return String(md5);
  } catch {
    // fall through to size + mtime
  }
  const info = await Zotero.getMainWindow().IOUtils.stat(path);
  return `stat:${info.size}:${info.lastModified}`;
}

/** Page texts of a PDF via Zotero's PDF worker (form feed = page break), as in SeekChat. */
export async function readPages(attachment: any): Promise<Page[]> {
  const result = await Zotero.PDFWorker.getFullText(attachment.id, null, true);
  const text: string = result?.text || '';
  return text.split('\f').map((t, i) => ({ pageNumber: i + 1, text: t.trim() }));
}

function authorsOf(item: any): string[] {
  return (item.getCreators?.() || [])
    .map((c: any) => (c.lastName ? [c.lastName, c.firstName].filter(Boolean).join(', ') : c.name || ''))
    .filter(Boolean);
}

function yearOf(item: any): number | null {
  const y = String(item.getField?.('date', true, true) || '').slice(0, 4);
  return /^\d{4}$/.test(y) ? Number(y) : null;
}

function field(item: any, name: string): string {
  try {
    return String(item.getField(name) || '');
  } catch {
    return '';
  }
}

export class Indexer {
  progress: Progress = { bookPk: null, attachmentKey: null, running: false, paused: false, book: 0, books: 0, title: '', chunk: 0, chunks: 0, lastError: null };
  private runPromise: Promise<void> | null = null;
  private stopRequested = false;
  private listeners = new Set<() => void>();

  constructor(private store: Store, private prefs: () => SeekBookPrefs = readPrefs) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) {
      try { fn(); } catch (e) { logError(e); }
    }
  }

  /** Clears everything when model or window settings changed since the index was built. */
  async checkConfig(): Promise<boolean> {
    const current = indexConfig(this.prefs());
    const stored = await this.store.getMeta('index_config');
    if (stored === current) return false;
    if (stored) {
      log('index configuration changed, rebuilding');
      await this.store.clearAll();
      scanPool.invalidate();
    }
    await this.store.setMeta('index_config', current);
    return !!stored;
  }

  async needsRebuild(): Promise<boolean> {
    const stored = await this.store.getMeta('index_config');
    return !!stored && stored !== indexConfig(this.prefs());
  }

  libraryIDs(): number[] {
    const wanted = this.prefs().libraries;
    const all: number[] = Zotero.Libraries.getAll()
      .map((l: any) => l.libraryID)
      .filter((id: number) => libraryKeyOf(id));
    if (!wanted.length) return all;
    return wanted.map(libraryIDOf).filter((id): id is number => id !== null && all.includes(id));
  }

  /** Brings books and documents in line with the libraries; returns the number of queued documents. */
  async scan(): Promise<number> {
    await this.checkConfig();
    const seen = new Set<number>();
    for (const libraryID of this.libraryIDs()) {
      const items: any[] = await Zotero.Items.getAll(libraryID, true, false);
      for (const item of items) {
        if (!item.isRegularItem?.() || item.itemType !== 'book' || item.deleted) continue;
        const bookPk = await this.syncBook(item);
        if (bookPk !== null) seen.add(bookPk);
      }
    }
    // Books that are gone, trashed or no longer books (or whose library is not indexed any more).
    for (const b of await this.store.books()) if (!seen.has(b.bookPk)) await this.removeBook(b.bookPk);
    const n = (await this.store.queued()).length;
    this.emit();
    return n;
  }

  async removeBook(bookPk: number): Promise<void> {
    for (const d of await this.store.documents(bookPk)) scanPool.invalidate(d.docPk);
    await this.store.deleteBook(bookPk);
  }

  /**
   * Records one book item and its attachments; new or changed PDFs are queued,
   * a duplicate is re-checked when another PDF of the book changes.
   * Returns book_pk, or null if the item is not indexed (and removes it then).
   */
  async syncBook(item: any): Promise<number | null> {
    const libraryKey = libraryKeyOf(item.libraryID);
    if (!libraryKey) return null;
    const prefs = this.prefs();
    const existing = await this.store.bookByKey(libraryKey, item.key);
    if (item.deleted || item.itemType !== 'book' || !this.libraryIDs().includes(item.libraryID)) {
      if (existing) await this.removeBook(existing.bookPk);
      return null;
    }
    const bookPk = await this.store.upsertBook({
      libraryKey, itemKey: item.key, title: field(item, 'title'), authors: authorsOf(item),
      year: yearOf(item), language: field(item, 'language'),
    });
    const bookExcluded = hasTag(item, prefs.excludeTag);
    const attachments: any[] = (item.getAttachments?.() || [])
      .map((id: number) => Zotero.Items.get(id))
      .filter((a: any) => a && !a.deleted && isFileAttachment(a));
    const ordered = orderDocuments(attachments.map((a) => ({
      key: a.key, title: field(a, 'title'), fileName: a.attachmentFilename || '', dateAdded: a.dateAdded || '', att: a,
    })));
    const known = new Map((await this.store.documents(bookPk)).map((d) => [d.attachmentKey, d]));
    let changed = false;
    for (const [i, o] of ordered.entries()) {
      const att = o.att;
      const doc = await this.store.upsertDocument({
        bookPk, attachmentKey: att.key, attachmentTitle: o.title, fileName: o.fileName, sortOrder: i,
      });
      known.delete(att.key);
      if (!isPdf(att)) {
        await this.store.setStatus(doc.docPk, 'excluded', { error: 'not a PDF (EPUB/HTML not supported yet)' });
        continue;
      }
      if (bookExcluded || hasTag(att, prefs.excludeTag)) {
        if (doc.status !== 'excluded') {
          await this.store.clearContent(doc.docPk);
          scanPool.invalidate(doc.docPk);
          changed = true;
        }
        await this.store.setStatus(doc.docPk, 'excluded', { error: `tag ${prefs.excludeTag}`, duplicateOf: null });
        continue;
      }
      const path = await att.getFilePathAsync();
      if (!path) {
        await this.store.setStatus(doc.docPk, 'failed', { error: 'file missing (not synced/downloaded)' });
        continue;
      }
      const hash = await fileHash(path);
      const upToDate = hash === doc.contentHash && doc.modelId === modelId(prefs)
        && (doc.status === 'ready' || doc.status === 'duplicate');
      if (!upToDate && !(doc.status === 'failed' && hash === doc.contentHash)) {
        await this.store.setStatus(doc.docPk, 'queued', { contentHash: hash, error: null });
        changed = true;
      }
    }
    // Attachments that are gone.
    for (const d of known.values()) {
      scanPool.invalidate(d.docPk);
      await this.store.deleteDocument(d.docPk);
      changed = true;
    }
    // Something changed: duplicates of this book are decided again.
    if (changed) {
      for (const d of await this.store.documents(bookPk)) {
        if (d.status === 'duplicate') await this.store.setStatus(d.docPk, 'queued');
      }
    }
    return bookPk;
  }

  /** Starts the queue unless it runs already; resolves when it stops. */
  run(): Promise<void> {
    if (this.runPromise) return this.runPromise;
    this.stopRequested = false;
    this.progress = { ...this.progress, running: true, paused: false, lastError: null };
    this.emit();
    this.runPromise = this.loop()
      .catch((e) => {
        logError(e);
        this.progress.lastError = String(e?.message || e);
      })
      .finally(() => {
        this.runPromise = null;
        this.progress.running = false;
        this.progress.title = '';
        this.progress.bookPk = null;
        this.progress.attachmentKey = null;
        this.emit();
      });
    return this.runPromise;
  }

  /** Scan, then run the queue. */
  async indexNow(): Promise<void> {
    await this.scan();
    await this.run();
  }

  /**
   * Context menu: adds books to the index (also without automatic indexing) or,
   * with `force`, indexes all their PDFs again (also failed ones), then runs the queue.
   * Returns the number of books that are in the index afterwards.
   */
  async indexBooks(items: any[], force: boolean): Promise<number> {
    await this.checkConfig();
    let n = 0;
    for (const item of items) {
      const bookPk = await this.syncBook(item);
      if (bookPk === null) continue;
      n++;
      if (!force) continue;
      for (const d of await this.store.documents(bookPk)) {
        if (['ready', 'failed', 'duplicate'].includes(d.status)) await this.store.setStatus(d.docPk, 'queued', { error: null });
      }
    }
    if (n) void this.run();
    this.emit();
    return n;
  }

  pause(): void {
    this.stopRequested = true;
    this.progress.paused = true;
    this.emit();
  }

  /** Waits for the current PDF to finish (or stop) without starting anything new. */
  async stop(): Promise<void> {
    this.stopRequested = true;
    await this.runPromise;
  }

  async rebuild(): Promise<void> {
    await this.stop();
    await this.store.clearAll();
    scanPool.invalidate();
    await this.store.setMeta('index_config', indexConfig(this.prefs()));
    await this.indexNow();
  }

  private async loop(): Promise<void> {
    const queued = await this.store.queued();
    const books = Array.from(new Set(queued.map((d) => d.bookPk)));
    this.progress.books = books.length;
    for (const [i, bookPk] of books.entries()) {
      if (this.stopRequested) return;
      this.progress.book = i + 1;
      await this.processBook(bookPk);
      // Let Zotero breathe between books.
      await Zotero.Promise.delay(0);
    }
    // New work may have arrived while running (notifier).
    if (!this.stopRequested && (await this.store.queued()).length) await this.loop();
  }

  /** Reads all non-ready PDFs of a book, decides duplicates, indexes the rest. */
  async processBook(bookPk: number): Promise<void> {
    const prefs = this.prefs();
    const book = await this.store.bookByPk(bookPk);
    if (!book) return;
    this.progress.title = book.title;
    this.progress.bookPk = bookPk;
    this.progress.attachmentKey = null;
    this.emit();
    const docs = (await this.store.documents(bookPk)).filter((d) => ['queued', 'indexing', 'ready', 'duplicate'].includes(d.status));
    const multi = docs.length > 1;
    const prepared = new Map<number, PreparedDocument & { labels: (string | null)[] | null }>();
    const dupInputs: DupInput[] = [];
    for (const d of docs) {
      if (this.stopRequested) return;
      if (d.status === 'ready') {
        dupInputs.push(await this.readyDupInput(d));
        continue;
      }
      try {
        const p = await this.prepare(book.libraryKey, d, prefs, multi);
        prepared.set(d.docPk, p);
        dupInputs.push({
          key: String(d.docPk), hash: d.contentHash, windows: p.windows.map((w) => w.text),
          text: p.windows.map((w) => w.text).join(' '), words: p.windows.reduce((s, w) => s + w.text.split(' ').length, 0),
        });
      } catch (e: any) {
        await this.store.setStatus(d.docPk, 'failed', { error: String(e?.message || e) });
      }
    }
    const dups = findDuplicates(dupInputs, prefs.preferDuplicates);
    for (const d of docs) {
      if (this.stopRequested) return;
      const dupOf = dups.get(String(d.docPk));
      if (dupOf) {
        if (d.status === 'ready') {
          await this.store.clearContent(d.docPk);
          scanPool.invalidate(d.docPk);
        }
        await this.store.setStatus(d.docPk, 'duplicate', { duplicateOf: Number(dupOf), error: null });
        continue;
      }
      const p = prepared.get(d.docPk);
      if (!p) continue;
      try {
        await this.store.setStatus(d.docPk, 'indexing');
        await this.embedAndWrite(book.title, d, p, prefs);
      } catch (e: any) {
        if (this.stopRequested && e?.name === 'StopError') {
          await this.store.setStatus(d.docPk, 'queued');
          return;
        }
        // Server trouble stops the run (the PDF stays queued); a broken PDF fails alone.
        if (e instanceof EmbeddingError || e?.code === 'HOST_REJECTED' || e instanceof TypeError) {
          await this.store.setStatus(d.docPk, 'queued');
          throw e;
        }
        await this.store.setStatus(d.docPk, 'failed', { error: String(e?.message || e) });
      }
    }
  }

  private async readyDupInput(d: DocRow): Promise<DupInput> {
    const rows = await this.store.query('SELECT text FROM chunks WHERE doc_pk = ? ORDER BY idx', [d.docPk]);
    const windows = rows.map((r) => r.text as string);
    return { key: String(d.docPk), hash: d.contentHash, windows, text: windows.join(' '), words: windows.reduce((s, w) => s + w.split(' ').length, 0) };
  }

  private async prepare(libraryKey: string, d: DocRow, prefs: SeekBookPrefs, multi: boolean) {
    const libraryID = libraryIDOf(libraryKey);
    const att = libraryID === null ? null : Zotero.Items.getByLibraryAndKey(libraryID, d.attachmentKey);
    if (!att) throw new Error('attachment not found');
    const t0 = Date.now();
    const pages = await readPages(att);
    L.info(`${d.attachmentKey} "${d.attachmentTitle}": ${pages.length} pages read in ${Date.now() - t0} ms`);
    let structure: { outline: any[]; labels: (string | null)[] | null } = { outline: [], labels: null };
    try {
      structure = await readPdfStructure(att);
    } catch (e) {
      // No bookmarks/labels: printed TOC, headings or page blocks instead.
      logError(e);
    }
    try {
      const p = prepareDocument(pages, {
        chunkWords: prefs.chunkWords, strideWords: prefs.strideWords, bookmarks: structure.outline,
        labels: structure.labels, docTitle: multi ? d.attachmentTitle || d.fileName : undefined,
      });
      return { ...p, labels: structure.labels };
    } catch (e) {
      if (e instanceof NoTextError) throw new Error('no text in the PDF (scanned?) – OCR needed');
      throw e;
    }
  }

  private async embedAndWrite(bookTitle: string, d: DocRow, p: PreparedDocument & { labels: (string | null)[] | null }, prefs: SeekBookPrefs): Promise<void> {
    const vectors: Float32Array[] = [];
    this.progress.attachmentKey = d.attachmentKey;
    this.progress.chunk = 0;
    this.progress.chunks = p.windows.length;
    this.emit();
    // Batches in parallel (embedConcurrency), results kept in window order.
    const batches: number[] = [];
    for (let i = 0; i < p.windows.length; i += prefs.batchSize) batches.push(i);
    const results: Float32Array[][] = new Array(batches.length);
    let next = 0;
    let done = 0;
    const lane = async () => {
      while (next < batches.length) {
        if (this.stopRequested) {
          const err = new Error('stopped');
          err.name = 'StopError';
          throw err;
        }
        const b = next++;
        const batch = p.windows.slice(batches[b], batches[b] + prefs.batchSize);
        const out = await embed(prefs, batch.map((w) => embeddingText(bookTitle, w.chapter, w.text, prefs.docPrefix)));
        results[b] = out.map((v) => normalize(v));
        done += out.length;
        this.progress.chunk = done;
        this.emit();
      }
    };
    const tEmbed = Date.now();
    await Promise.all(Array.from({ length: Math.min(prefs.embedConcurrency, batches.length) }, lane));
    L.info(`${d.attachmentKey}: ${batches.length} embedding batches in ${Date.now() - tEmbed} ms (concurrency ${prefs.embedConcurrency})`);
    for (const r of results) vectors.push(...r);
    const chunks = p.windows.map((w, i) => {
      const keys = termKeys(`${w.chapter} ${w.text}`);
      const terms = new Map<string, number>();
      for (const k of keys) terms.set(k, (terms.get(k) || 0) + 1);
      const { q, scale } = quantize(vectors[i]);
      return {
        idx: w.idx, pageStart: w.pageStart, pageEnd: w.pageEnd, charStart: w.charStart, charEnd: w.charEnd,
        chapter: w.chapter, text: w.text, embedding: floatToBytes(vectors[i]), embeddingQ: int8ToBytes(q), scale,
        terms, nterms: keys.length,
      };
    });
    await this.store.writeDocument(d.docPk, d.contentHash, modelId(prefs), {
      chunks,
      pages: p.stripped.map((x) => ({ page: x.pageNumber, text: x.text })),
      labels: p.labels,
      outline: flattenOutline(p.outline, p.chapters),
      outlineSource: p.outline.source,
      pageCount: p.pages,
    });
    await this.store.setMeta('dims', String(vectors[0]?.length || 0));
    scanPool.invalidate(d.docPk);
    L.info(`indexed ${d.attachmentKey}: ${chunks.length} windows, outline ${p.outline.source}`);
  }
}
