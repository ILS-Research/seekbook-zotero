/**
 * Search over the index: int8 candidate scan + exact float32 rescoring
 * (semantic), BM25 over the term table (keyword), RRF fusion (hybrid), then
 * neighbouring windows of the same PDF merged into passages.
 *
 * Result shape = ZotSeek's `results[]` for granularity=passages, plus fields
 * ZotSeek parsers ignore (pageEnd, pageLabel, chapter, attachmentKey …).
 */
import { logger } from '../util/log';
import { embed } from './embed/client';
import { bytesToFloat, dot, normalize } from './embed/vectors';
import { loadDocVectors, ScanPool } from './scan-pool';
import { bm25, mergePassages, ranked, rrf, type Hit, type Posting } from './ranking';
import type { Store } from './store';
import { termKeys } from './text/tokenize';
import { readPrefs, type SeekBookPrefs } from '../prefs';

export type SearchMode = 'hybrid' | 'semantic' | 'keyword';

export interface SearchOptions {
  topK?: number;
  libraryKey?: string;
  mode?: SearchMode;
  minSimilarity?: number;
  itemKeys?: string[];
  attachmentKeys?: string[];
  expand?: 'none' | 'page';
}

export interface SearchResult {
  itemKey: string;
  libraryKey: string;
  title: string;
  authors: string[];
  year: number | null;
  itemType: 'book';
  score: number;
  semanticScore: number | null;
  keywordScore: number | null;
  source: 'semantic' | 'keyword' | 'both';
  matchedChunk: {
    snippet: string;
    page: number;
    pageEnd: number;
    pageLabel: string | null;
    chapter: string | null;
    chapterSource: string | null;
    textSource: 'book';
    attachmentKey: string;
    attachmentTitle: string;
    chunkIndex: number;
  };
}

/** Candidates from the int8 scan that get an exact float32 score. */
export const CANDIDATES = 200;

/** Candidate scan in worker threads, shared by search and indexer (invalidation). */
export const scanPool = new ScanPool();

interface ScopeDoc {
  docPk: number;
  attachmentKey: string;
  attachmentTitle: string;
  outlineSource: string | null;
  bookPk: number;
  libraryKey: string;
  itemKey: string;
  title: string;
  authors: string;
  year: number | null;
}

async function scopeDocs(store: Store, opts: SearchOptions): Promise<ScopeDoc[]> {
  const where = [`d.status = 'ready'`];
  const params: unknown[] = [];
  if (opts.libraryKey) { where.push('b.library_key = ?'); params.push(opts.libraryKey); }
  if (opts.itemKeys?.length) { where.push(`b.item_key IN (${opts.itemKeys.map(() => '?').join(',')})`); params.push(...opts.itemKeys); }
  if (opts.attachmentKeys?.length) {
    where.push(`d.attachment_key IN (${opts.attachmentKeys.map(() => '?').join(',')})`);
    params.push(...opts.attachmentKeys);
  }
  const rows = await store.query(
    `SELECT d.doc_pk, d.attachment_key, d.attachment_title, d.outline_source, b.book_pk, b.library_key, b.item_key,
       b.title, b.authors, b.year
     FROM documents d JOIN books b ON b.book_pk = d.book_pk WHERE ${where.join(' AND ')}`, params);
  return rows.map((r) => ({
    docPk: r.doc_pk, attachmentKey: r.attachment_key, attachmentTitle: r.attachment_title || '',
    outlineSource: r.outline_source ?? null, bookPk: r.book_pk, libraryKey: r.library_key, itemKey: r.item_key,
    title: r.title || '', authors: r.authors || '[]', year: r.year ?? null,
  }));
}

function inList(ids: number[]): string {
  return ids.map((id) => Number(id)).filter(Number.isFinite).join(',');
}

async function semanticScores(store: Store, docs: ScopeDoc[], query: string, prefs: SeekBookPrefs): Promise<Map<number, number>> {
  const [vec] = await embed(prefs, [prefs.queryPrefix + query]);
  const q = normalize(vec);
  const candidates = (await scanPool.search(q, docs.map((d) => d.docPk), CANDIDATES, (pk) => loadDocVectors(store, pk)))
    .map((c) => c.id);
  const exact = new Map<number, number>();
  if (!candidates.length) return exact;
  // Final ranking on float32: as exact as a pure float32 search.
  const rows = await store.queryArrays(
    `SELECT chunk_pk, ${store.vectorColumn('embedding')} FROM chunks WHERE chunk_pk IN (${inList(candidates)})`);
  for (const r of rows) exact.set(r[0] as number, dot(q, bytesToFloat(store.decodeVector(r[1]))));
  return exact;
}

async function keywordScores(store: Store, docs: ScopeDoc[], query: string): Promise<Map<number, number>> {
  const terms = Array.from(new Set(termKeys(query)));
  if (!terms.length || !docs.length) return new Map();
  const docList = inList(docs.map((d) => d.docPk));
  const stats = (await store.query(`SELECT COUNT(*) AS n, AVG(nterms) AS avg FROM chunks WHERE doc_pk IN (${docList})`))[0];
  const rows = await store.query(
    `SELECT t.chunk_pk, t.term, t.tf, c.nterms FROM terms t JOIN chunks c ON c.chunk_pk = t.chunk_pk
     WHERE t.term IN (${terms.map(() => '?').join(',')}) AND c.doc_pk IN (${docList})`, terms);
  const postings: Posting[] = rows.map((r) => ({ chunkPk: r.chunk_pk, term: r.term, tf: r.tf, nterms: r.nterms }));
  return bm25(postings, stats?.n || 0, stats?.avg || 0);
}

const L = logger('Search');

export async function search(store: Store, query: string, opts: SearchOptions = {}, prefs = readPrefs()): Promise<SearchResult[]> {
  const topK = Math.min(100, Math.max(1, opts.topK ?? 20));
  const mode = opts.mode ?? 'hybrid';
  const t0 = Date.now();
  const docs = await scopeDocs(store, opts);
  L.info(`"${query.slice(0, 100)}" (${mode}, topK ${topK}${opts.itemKeys ? `, ${opts.itemKeys.length} books` : ''}${opts.libraryKey ? `, ${opts.libraryKey}` : ''}): ${docs.length} PDFs in scope`);
  if (!docs.length) return [];
  const byDoc = new Map(docs.map((d) => [d.docPk, d]));

  let sem = new Map<number, number>();
  let kw = new Map<number, number>();
  if (mode !== 'keyword') {
    sem = await L.time('semantic (query embedding + scan)', () => semanticScores(store, docs, query, prefs), (m) => `${m.size} windows`);
    if (opts.minSimilarity !== undefined) for (const [id, s] of sem) if (s < opts.minSimilarity) sem.delete(id);
  }
  if (mode !== 'semantic') kw = await L.time('keyword (BM25)', () => keywordScores(store, docs, query), (m) => `${m.size} windows`);
  const maxKw = Math.max(0, ...kw.values());

  const fused = mode === 'hybrid' ? rrf([ranked(sem, CANDIDATES), ranked(kw, CANDIDATES)]) : mode === 'semantic' ? sem : kw;
  // Neighbours merge into one passage, so fetch a few more windows than passages wanted.
  const ids = ranked(fused, topK * 3);
  if (!ids.length) return [];
  const rows = await store.query(
    `SELECT chunk_pk, doc_pk, idx, page_start, page_end, chapter, text FROM chunks WHERE chunk_pk IN (${inList(ids)})`);
  const hits: Hit[] = rows.map((r) => ({
    chunkPk: r.chunk_pk, docPk: r.doc_pk, idx: r.idx, pageStart: r.page_start, pageEnd: r.page_end,
    chapter: r.chapter || '', text: r.text, score: fused.get(r.chunk_pk) || 0,
    semanticScore: sem.has(r.chunk_pk) ? sem.get(r.chunk_pk)! : null,
    keywordScore: kw.has(r.chunk_pk) && maxKw > 0 ? kw.get(r.chunk_pk)! / maxKw : null,
  }));
  const passages = mergePassages(hits).slice(0, topK);

  const labels = new Map<number, Map<number, string>>();
  const out: SearchResult[] = [];
  for (const p of passages) {
    const d = byDoc.get(p.docPk)!;
    if (!labels.has(p.docPk)) labels.set(p.docPk, await store.pageLabels(p.docPk));
    let snippet = p.text;
    if (opts.expand === 'page') {
      const pages = await store.pages(p.docPk, p.pageStart, p.pageEnd);
      if (pages.length) snippet = pages.map((x) => x.text).join('\n\n');
    }
    let authors: string[] = [];
    try { authors = JSON.parse(d.authors); } catch { /* keep empty */ }
    out.push({
      itemKey: d.itemKey,
      libraryKey: d.libraryKey,
      title: d.title,
      authors,
      year: d.year,
      itemType: 'book',
      score: round(p.score, 5),
      semanticScore: p.semanticScore === null ? null : round(p.semanticScore, 4),
      keywordScore: p.keywordScore === null ? null : round(p.keywordScore, 4),
      source: p.semanticScore !== null && p.keywordScore !== null ? 'both' : p.semanticScore !== null ? 'semantic' : 'keyword',
      matchedChunk: {
        snippet,
        page: p.pageStart,
        pageEnd: p.pageEnd,
        pageLabel: labels.get(p.docPk)!.get(p.pageStart) ?? null,
        chapter: p.chapter || null,
        chapterSource: d.outlineSource,
        textSource: 'book',
        attachmentKey: d.attachmentKey,
        attachmentTitle: d.attachmentTitle,
        chunkIndex: p.idx,
      },
    });
  }
  L.info(`${out.length} passages in ${Date.now() - t0} ms`);
  return out;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
