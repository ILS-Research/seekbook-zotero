/**
 * Search worker (ChromeWorker): keeps the int8 vectors of the PDFs the main
 * thread handed over and scans them for a query, so Zotero's UI never waits
 * for a search. Protocol (all typed arrays are transferred, not copied):
 *   { type: 'load', docPk, dims, chunkPks, scales, matrix }
 *   { type: 'drop', docPk } · { type: 'clear' }
 *   { type: 'search', id, query, docPks, k }  →  { id, ids, scores, missing } | { id, error }
 */
import { scanTopK } from '../core/scan';
import type { PackedVectors } from '../core/store';

const docs = new Map<number, PackedVectors>();

(self as any).onmessage = (e: MessageEvent) => {
  const m = e.data;
  switch (m.type) {
    case 'load':
      docs.set(m.docPk, { dims: m.dims, chunkPks: m.chunkPks, scales: m.scales, matrix: m.matrix });
      break;
    case 'drop':
      docs.delete(m.docPk);
      break;
    case 'clear':
      docs.clear();
      break;
    case 'search': {
      try {
        const have: PackedVectors[] = [];
        const missing: number[] = [];
        for (const pk of m.docPks as number[]) {
          const d = docs.get(pk);
          if (d) have.push(d);
          else missing.push(pk);
        }
        const r = scanTopK(m.query, have, m.k);
        (self as any).postMessage({ id: m.id, ids: r.ids, scores: r.scores, missing }, [r.ids.buffer, r.scores.buffer]);
      } catch (err: any) {
        (self as any).postMessage({ id: m.id, error: String(err?.message || err) });
      }
      break;
    }
  }
};
