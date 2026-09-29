/**
 * int8 candidate scan, shared by the search worker and the main-thread
 * fallback. Pure (no Zotero), unit-tested.
 */
import type { PackedVectors } from './store';

/** Best `k` chunks over `docs` by int8 cosine against a normalized float query: parallel arrays, best first. */
export function scanTopK(query: Float32Array, docs: PackedVectors[], k: number): { ids: Int32Array; scores: Float32Array } {
  const ids = new Int32Array(k);
  const scores = new Float32Array(k).fill(-Infinity);
  let size = 0;
  let minIdx = 0;
  const dims = query.length;
  for (const d of docs) {
    if (d.dims !== dims) throw new Error(`index has ${d.dims} dimensions, the query ${dims}: rebuild the index (model changed?)`);
    const m = d.matrix;
    for (let row = 0, off = 0; row < d.chunkPks.length; row++, off += dims) {
      let s = 0;
      for (let i = 0; i < dims; i++) s += query[i] * m[off + i];
      s *= d.scales[row];
      if (size < k) {
        ids[size] = d.chunkPks[row];
        scores[size] = s;
        size++;
        if (size === k) minIdx = argMin(scores, size);
      } else if (s > scores[minIdx]) {
        ids[minIdx] = d.chunkPks[row];
        scores[minIdx] = s;
        minIdx = argMin(scores, size);
      }
    }
  }
  const order = Array.from({ length: size }, (_, i) => i).sort((a, b) => scores[b] - scores[a]);
  return { ids: Int32Array.from(order, (i) => ids[i]), scores: Float32Array.from(order, (i) => scores[i]) };
}

function argMin(a: Float32Array, n: number): number {
  let m = 0;
  for (let i = 1; i < n; i++) if (a[i] < a[m]) m = i;
  return m;
}

/** Merges per-worker results into the best `k`. */
export function mergeTopK(parts: { ids: Int32Array; scores: Float32Array }[], k: number): { id: number; score: number }[] {
  const all: { id: number; score: number }[] = [];
  for (const p of parts) for (let i = 0; i < p.ids.length; i++) all.push({ id: p.ids[i], score: p.scores[i] });
  return all.sort((a, b) => b.score - a.score).slice(0, k);
}
