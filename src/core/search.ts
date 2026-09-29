/**
 * Search over the index: int8 candidate scan + exact float32 rescoring
 * (semantic), BM25 over the term table (keyword), RRF fusion (hybrid), then
 * neighbouring windows of the same PDF merged into passages.
 *
 * Result shape = ZotSeek's `results[]` for granularity=passages, plus fields
 * ZotSeek parsers ignore (pageEnd, pageLabel, chapter, attachmentKey …).
 */
import { embed } from './embed/client';
import { bytesToFloat, bytesToInt8, dot, dotInt8, normalize } from './embed/vectors';
import { bm25, mergePassages, ranked, rrf, TopK, type Hit, type Posting } from './ranking';
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
/** Upper bound of cached int8 vectors in bytes. */
export const CACHE_BYTES = 200 * 1024 * 1024;

interface DocVectors {
  chunkPks: number[];
  scales: Float32Array;
  matrix: Int8Array;
  dims: number;
  bytes: number;
}

/** int8 vectors per document, least recently used dropped first. */
export class VectorCache {
  private map = new Map<number, DocVectors>();
  private bytes = 0;

  constructor(private limit = CACHE_BYTES) {}

  async get(store: Store, docPk: number): Promise<DocVectors> {
    const hit = this.map.get(docPk);
    if (hit) {
      this.map.delete(docPk);
      this.map.set(docPk, hit);
      return hit;
    }
    const rows = await store.queryArrays(
      `SELECT chunk_pk, ${store.vectorColumn('embedding_q')}, scale FROM chunks WHERE doc_pk = ? ORDER BY idx`, [docPk]);
    const vectors = rows.map((r) => bytesToInt8(store.decodeVector(r[1])));
    const dims = vectors[0]?.length || 0;
    const matrix = new Int8Array(dims * vectors.length);
    vectors.forEach((v, i) => matrix.set(v.subarray(0, dims), i * dims));
    const entry: DocVectors = {
      chunkPks: rows.map((r) => r[0] as number),
      scales: Float32Array.from(rows.map((r) => r[2] as number)),
      matrix, dims, bytes: matrix.byteLength,
    };
    this.map.set(docPk, entry);
    this.bytes += entry.bytes;
    for (const [key, v] of this.map) {
      if (this.bytes <= this.limit || key === docPk) break;
      this.map.delete(key);
      this.bytes -= v.bytes;
    }
    return entry;
  }

  invalidate(docPk?: number): void {
    if (docPk === undefined) {
      this.map.clear();
      this.bytes = 0;
      return;
    }
    const v = this.map.get(docPk);
    if (v) this.bytes -= v.bytes;
    this.map.delete(docPk);
  }
}

export const vectorCache = new VectorCache();

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
  const top = new TopK(CANDIDATES);
  for (const d of docs) {
    const v = await vectorCache.get(store, d.docPk);
    if (v.dims !== q.length) {
      throw new Error(`index has ${v.dims} dimensions, the model returned ${q.length}: rebuild the index (model changed?)`);
    }
    for (let i = 0; i < v.chunkPks.length; i++) top.push(v.chunkPks[i], dotInt8(q, v.matrix, i * v.dims, v.scales[i]));
  }
  const candidates = top.result().map((c) => c.id);
  const exact = new Map<number, number>();
  if (!candidates.length) return exact;
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

export async function search(store: Store, query: string, opts: SearchOptions = {}, prefs = readPrefs()): Promise<SearchResult[]> {
  const topK = Math.min(100, Math.max(1, opts.topK ?? 20));
  const mode = opts.mode ?? 'hybrid';
  const docs = await scopeDocs(store, opts);
  if (!docs.length) return [];
  const byDoc = new Map(docs.map((d) => [d.docPk, d]));

  let sem = new Map<number, number>();
  let kw = new Map<number, number>();
  if (mode !== 'keyword') {
    sem = await semanticScores(store, docs, query, prefs);
    if (opts.minSimilarity !== undefined) for (const [id, s] of sem) if (s < opts.minSimilarity) sem.delete(id);
  }
  if (mode !== 'semantic') kw = await keywordScores(store, docs, query);
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
  return out;
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
