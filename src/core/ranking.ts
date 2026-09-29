/**
 * Ranking without Zotero: BM25 over term postings, reciprocal rank fusion
 * (k = 60, like ZotSeek's hybrid-search.ts) and merging of neighbouring
 * windows into passages. Pure, unit-tested.
 */

export interface Posting {
  chunkPk: number;
  term: string;
  tf: number;
  /** Number of terms of the chunk (document length for BM25). */
  nterms: number;
}

export const BM25_K1 = 1.2;
export const BM25_B = 0.75;
export const RRF_K = 60;

/** BM25 per chunk; `total` chunks in scope with average length `avgLen`. */
export function bm25(postings: Posting[], total: number, avgLen: number): Map<number, number> {
  const df = new Map<string, number>();
  for (const p of postings) df.set(p.term, (df.get(p.term) || 0) + 1);
  const scores = new Map<number, number>();
  const avg = avgLen > 0 ? avgLen : 1;
  for (const p of postings) {
    const n = df.get(p.term) || 0;
    const idf = Math.log(1 + (total - n + 0.5) / (n + 0.5));
    const s = idf * (p.tf * (BM25_K1 + 1)) / (p.tf + BM25_K1 * (1 - BM25_B + BM25_B * p.nterms / avg));
    scores.set(p.chunkPk, (scores.get(p.chunkPk) || 0) + s);
  }
  return scores;
}

/** Ids by descending score. */
export function ranked(scores: Map<number, number>, limit = Infinity): number[] {
  return [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([id]) => id);
}

/** Reciprocal rank fusion of ranked id lists (ranks only, scores are not compared). */
export function rrf(lists: number[][], k = RRF_K): Map<number, number> {
  const out = new Map<number, number>();
  for (const list of lists) {
    list.forEach((id, rank) => out.set(id, (out.get(id) || 0) + 1 / (k + rank + 1)));
  }
  return out;
}

export interface Hit {
  chunkPk: number;
  docPk: number;
  idx: number;
  pageStart: number;
  pageEnd: number;
  chapter: string;
  text: string;
  score: number;
  semanticScore: number | null;
  keywordScore: number | null;
}

export interface Passage extends Hit {
  /** Chunks merged into this passage, in text order. */
  chunkPks: number[];
}

/** Words the end of `a` shares with the start of `b` (window overlap), 0 if none. */
export function overlapWords(a: string[], b: string[]): number {
  const max = Math.min(a.length, b.length);
  for (let k = max; k > 0; k--) {
    let same = true;
    for (let i = 0; i < k && same; i++) same = a[a.length - k + i] === b[i];
    if (same) return k;
  }
  return 0;
}

function maxOrNull(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

/**
 * Windows at most merged into one passage (≈ 440 words with 200/120). Without a
 * cap a run of hits grew into passages of five pages and more, which callers
 * like SeekChat then sent whole, and again in overlapping pieces.
 */
export const MAX_MERGE_WINDOWS = 3;

/**
 * Merges hits of the same PDF whose windows overlap or follow each other
 * (idx difference ≤ 1) into one passage of at most `maxWindows` windows: text
 * and page range united, best scores kept. Passages come back by descending score.
 */
export function mergePassages(hits: Hit[], maxWindows = MAX_MERGE_WINDOWS): Passage[] {
  const byDoc = new Map<number, Hit[]>();
  for (const h of hits) {
    const list = byDoc.get(h.docPk) || [];
    list.push(h);
    byDoc.set(h.docPk, list);
  }
  const out: Passage[] = [];
  for (const list of byDoc.values()) {
    list.sort((a, b) => a.idx - b.idx);
    let cur: (Passage & { lastIdx: number; words: string[] }) | null = null;
    for (const h of list) {
      if (cur && h.idx - cur.lastIdx <= 1 && cur.chunkPks.length < maxWindows) {
        const words = h.text.split(' ');
        const k = overlapWords(cur.words, words);
        cur.words = cur.words.concat(words.slice(k));
        cur.pageEnd = Math.max(cur.pageEnd, h.pageEnd);
        cur.lastIdx = h.idx;
        cur.chunkPks.push(h.chunkPk);
        if (h.score > cur.score) {
          cur.score = h.score;
          cur.idx = h.idx;
          cur.chunkPk = h.chunkPk;
        }
        cur.semanticScore = maxOrNull(cur.semanticScore, h.semanticScore);
        cur.keywordScore = maxOrNull(cur.keywordScore, h.keywordScore);
        continue;
      }
      if (cur) out.push(cur);
      cur = { ...h, chunkPks: [h.chunkPk], lastIdx: h.idx, words: h.text.split(' ') };
    }
    if (cur) out.push(cur);
  }
  return out
    .map((p: any) => {
      const { lastIdx, words, ...rest } = p;
      return { ...rest, text: words.join(' ') } as Passage;
    })
    .sort((a, b) => b.score - a.score || a.docPk - b.docPk || a.idx - b.idx);
}

/** Keeps the best `size` entries of (id, score) pairs; cheap for large scans. */
export class TopK {
  private items: { id: number; score: number }[] = [];
  private min = -Infinity;

  constructor(private size: number) {}

  push(id: number, score: number): void {
    if (this.items.length >= this.size && score <= this.min) return;
    this.items.push({ id, score });
    if (this.items.length > this.size * 2) this.compact();
  }

  private compact(): void {
    this.items.sort((a, b) => b.score - a.score);
    this.items.length = Math.min(this.items.length, this.size);
    this.min = this.items.length >= this.size ? this.items[this.items.length - 1].score : -Infinity;
  }

  result(): { id: number; score: number }[] {
    this.compact();
    return this.items;
  }
}
