/**
 * REST interface on Zotero's local server (127.0.0.1:<Zotero.Server.port>):
 * GET /seekbook/stats, /seekbook/search, /seekbook/pages, /seekbook/books.
 *
 * Security: callers send `Zotero-Allowed-Request: 1` (Zotero's server drops browser requests
 * without it). SeekBook itself accepts only a loopback Host header (DNS rebinding: a web page
 * whose domain resolves to 127.0.0.1 would otherwise read book text with same-origin GETs, which
 * carry no Origin; Zotero checks this itself only since 2026) and a missing or loopback Origin.
 * Search results have the shape of ZotSeek's `/zotseek/search` results.
 */
import type { Indexer } from './indexer';
import { search, type SearchMode, type SearchOptions } from './search';
import type { Store } from './store';
import { isValidLibraryKey } from './zotero-items';
import { readPrefs } from '../prefs';
import { logger } from '../util/log';

const L = logger('REST');

export const API_VERSION = 1;
export const PATHS = { stats: '/seekbook/stats', search: '/seekbook/search', pages: '/seekbook/pages', books: '/seekbook/books' };
export const MAX_PAGES = 10;

type Response = [number, string, string];

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Record<string, unknown> = {}) {
    super(message);
  }
}

function json(status: number, payload: unknown): Response {
  return [status, 'application/json', JSON.stringify(payload)];
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin);
}

/** Host header of a request to this computer; same rule as Zotero's own server. */
export function isAllowedHost(host: string | null | undefined): boolean {
  return !!host && /^(?:127\.0\.0\.1|\[::1\]|localhost)(?::\d+)?$/i.test(host);
}

function list(value: string | null): string[] | undefined {
  const parts = (value || '').split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
}

/** Validated search options from query parameters (ZotSeek's names plus SeekBook's). */
export function parseSearchParams(sp: URLSearchParams): { q: string; opts: SearchOptions } {
  const q = (sp.get('q') || '').trim();
  if (!q) throw new HttpError(400, 'Missing required query parameter: q');
  const opts: SearchOptions = {};
  if (sp.has('topK')) {
    const n = Number(sp.get('topK'));
    if (!Number.isInteger(n) || n < 1 || n > 100) throw new HttpError(400, 'topK must be an integer 1-100');
    opts.topK = n;
  }
  const mode = sp.get('mode');
  if (mode) {
    if (!['hybrid', 'semantic', 'keyword'].includes(mode)) throw new HttpError(400, 'mode must be hybrid, semantic or keyword');
    opts.mode = mode as SearchMode;
  }
  const lib = sp.get('libraryKey');
  if (lib) {
    if (!isValidLibraryKey(lib)) throw new HttpError(400, 'libraryKey must be "user" or "group:<id>"');
    opts.libraryKey = lib;
  }
  if (sp.has('minSimilarity')) {
    const v = Number(sp.get('minSimilarity'));
    if (!Number.isFinite(v)) throw new HttpError(400, 'minSimilarity must be a number');
    opts.minSimilarity = v;
  }
  const granularity = sp.get('granularity');
  if (granularity && granularity !== 'passages') throw new HttpError(400, 'granularity must be "passages"');
  const expand = sp.get('expand');
  if (expand) {
    if (expand !== 'none' && expand !== 'page') throw new HttpError(400, 'expand must be none or page');
    opts.expand = expand;
  }
  opts.itemKeys = list(sp.get('itemKeys'));
  opts.attachmentKeys = list(sp.get('attachmentKeys'));
  return { q, opts };
}

/** "45" or "10-12" → [from, to]; at most MAX_PAGES pages. */
export function parsePageRange(value: string | null): [number, number] {
  const m = (value || '').trim().match(/^(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?$/);
  if (!m) throw new HttpError(400, 'pages must be "N" or "N-M"');
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  if (from < 1 || to < from) throw new HttpError(400, 'pages must be 1-based and ascending');
  if (to - from + 1 > MAX_PAGES) throw new HttpError(400, `at most ${MAX_PAGES} pages per request`);
  return [from, to];
}

export async function statsPayload(store: Store, indexer: Indexer): Promise<Record<string, unknown>> {
  const prefs = readPrefs();
  const c = await store.counts();
  const configured = !!(prefs.baseUrl && prefs.model);
  return {
    ready: (c.books || 0) > 0 && configured,
    indexedBooks: c.books || 0,
    indexedDocuments: c.ready || 0,
    duplicateDocuments: c.duplicate || 0,
    queuedDocuments: (c.queued || 0) + (c.indexing || 0),
    failedDocuments: c.failed || 0,
    excludedDocuments: c.excluded || 0,
    totalChunks: c.chunks || 0,
    model: prefs.model,
    dims: Number(await store.getMeta('dims')) || null,
    chunkWords: prefs.chunkWords,
    strideWords: prefs.strideWords,
    schemaVersion: Number(await store.getMeta('schema_version')) || null,
    apiVersion: API_VERSION,
    indexing: indexer.progress.running,
    needsRebuild: await indexer.needsRebuild(),
  };
}

export async function pagesPayload(store: Store, sp: URLSearchParams): Promise<Record<string, unknown>> {
  const libraryKey = sp.get('libraryKey') || 'user';
  if (!isValidLibraryKey(libraryKey)) throw new HttpError(400, 'libraryKey must be "user" or "group:<id>"');
  let docPk: number;
  let from: number;
  let to: number;
  const attachmentKey = sp.get('attachmentKey');
  if (attachmentKey) {
    const doc = await store.documentByKey(libraryKey, attachmentKey);
    if (!doc || doc.status !== 'ready') throw new HttpError(404, 'attachment not indexed');
    docPk = doc.docPk;
    [from, to] = parsePageRange(sp.get('pages'));
  } else {
    const itemKey = sp.get('itemKey');
    const label = (sp.get('pageLabel') || '').trim();
    if (!itemKey || !label) throw new HttpError(400, 'attachmentKey + pages, or itemKey + pageLabel required');
    const book = await store.bookByKey(libraryKey, itemKey);
    if (!book) throw new HttpError(404, 'book not indexed');
    const hits = await store.docsWithLabel(book.bookPk, label);
    if (!hits.length) throw new HttpError(404, `no PDF of this book has page label ${label}`);
    if (hits.length > 1) {
      const candidates = [];
      for (const h of hits) {
        const d = await store.documentByPk(h.docPk);
        candidates.push({ attachmentKey: d?.attachmentKey, attachmentTitle: d?.attachmentTitle, page: h.page });
      }
      throw new HttpError(409, 'page label is ambiguous', { candidates });
    }
    docPk = hits[0].docPk;
    from = to = hits[0].page;
  }
  const doc = await store.documentByPk(docPk);
  const labels = await store.pageLabels(docPk);
  const pages = await store.pages(docPk, from, to);
  if (!pages.length) throw new HttpError(404, 'pages out of range');
  return {
    attachmentKey: doc!.attachmentKey,
    attachmentTitle: doc!.attachmentTitle,
    pages: pages.map((p) => ({ page: p.page, label: labels.get(p.page) ?? null, text: p.text })),
  };
}

/**
 * Books of one library and how much of each is searchable, optionally only
 * `itemKeys`. Lets callers split books between this index and their own
 * reading (a book is searchable once one of its PDFs is ready).
 */
export async function booksPayload(store: Store, sp: URLSearchParams): Promise<Record<string, unknown>> {
  const libraryKey = sp.get('libraryKey') || 'user';
  if (!isValidLibraryKey(libraryKey)) throw new HttpError(400, 'libraryKey must be "user" or "group:<id>"');
  const only = list(sp.get('itemKeys'));
  const wanted = only ? new Set(only) : null;
  const books = [];
  for (const b of await store.books()) {
    if (b.libraryKey !== libraryKey || (wanted && !wanted.has(b.itemKey))) continue;
    const docs = await store.documents(b.bookPk);
    const count = (...st: string[]) => docs.filter((d) => st.includes(d.status)).length;
    books.push({
      itemKey: b.itemKey,
      readyDocuments: count('ready'),
      queuedDocuments: count('queued', 'indexing'),
      failedDocuments: count('failed'),
      totalDocuments: docs.length,
      searchable: count('ready') > 0,
    });
  }
  return { libraryKey, apiVersion: API_VERSION, books };
}

function guard(handler: (sp: URLSearchParams) => Promise<unknown>, path = '') {
  return async (requestData: any): Promise<Response> => {
    const t0 = Date.now();
    const done = (r: Response) => {
      L.info(`GET ${path}?${requestData?.searchParams || ''} → ${r[0]} in ${Date.now() - t0} ms`);
      return r;
    };
    const headers = requestData?.headers || {};
    if (!isAllowedHost(headers['host'] ?? headers['Host'])) {
      return done(json(403, { error: 'Forbidden: Host must be 127.0.0.1, localhost or [::1]' }));
    }
    if (!isAllowedOrigin(headers['origin'] ?? headers['Origin'])) {
      return done(json(403, { error: 'Forbidden: non-local Origin' }));
    }
    try {
      return done(json(200, await handler(requestData.searchParams || new URLSearchParams())));
    } catch (e: any) {
      if (e instanceof HttpError) {
        L.warn(`${path}: ${e.status} ${e.message}`);
        return done(json(e.status, { error: e.message, ...e.extra }));
      }
      L.error(`${path}: ${e?.message || e}`);
      return done(json(500, { error: String(e?.message || e) }));
    }
  };
}

function endpoint(init: (requestData: any) => Promise<Response>): any {
  const E: any = function () {};
  E.prototype = { supportedMethods: ['GET'], supportedDataTypes: ['application/json'], permitBookmarklet: false, init };
  return E;
}

export function registerEndpoints(store: Store, indexer: Indexer): void {
  const server = Zotero.Server;
  if (!server?.Endpoints) return;
  server.Endpoints[PATHS.stats] = endpoint(guard(() => statsPayload(store, indexer), PATHS.stats));
  server.Endpoints[PATHS.search] = endpoint(guard(async (sp) => {
    const { q, opts } = parseSearchParams(sp);
    const prefs = readPrefs();
    const mode = opts.mode ?? 'hybrid';
    if ((await store.counts()).books === 0) throw new HttpError(503, 'not ready');
    if (mode !== 'keyword' && !(prefs.baseUrl && prefs.model)) throw new HttpError(503, 'not ready');
    let results;
    try {
      results = await search(store, q, opts, prefs);
    } catch (e: any) {
      // Mostly the embedding server (down, rejected host): the index is there, the query vector is not.
      throw new HttpError(503, `search failed: ${e?.message || e}`);
    }
    return { query: q, mode, source: 'seekbook', apiVersion: API_VERSION, results };
  }, PATHS.search));
  server.Endpoints[PATHS.pages] = endpoint(guard((sp) => pagesPayload(store, sp), PATHS.pages));
  server.Endpoints[PATHS.books] = endpoint(guard((sp) => booksPayload(store, sp), PATHS.books));
}

export function unregisterEndpoints(): void {
  const server = Zotero.Server;
  if (!server?.Endpoints) return;
  for (const path of Object.values(PATHS)) delete server.Endpoints[path];
}
