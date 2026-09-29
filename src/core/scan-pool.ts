/**
 * Candidate scan off the main thread: a small pool of ChromeWorkers keeps the
 * packed int8 vectors of recently searched PDFs resident (up to a memory
 * limit, least recently used dropped first) and scans them per query.
 *
 * Each PDF lives in one worker (the one holding the fewest bytes when it is
 * loaded); a query goes to all workers in parallel and their best candidates
 * are merged. A scope larger than the limit is scanned in turns. Without
 * ChromeWorker (unit tests, a broken worker) the same scan runs in-process,
 * yielding between PDFs.
 */
import { mergeTopK, scanTopK } from './scan';
import { unpackVectors, type PackedVectors, type Store } from './store';
import { logError } from '../util/log';

const WORKER_URL = 'chrome://seekbook/content/scripts/search-worker.js';
export const DEFAULT_CACHE_MB = 1024;

interface Resident {
  worker: number;
  bytes: number;
  used: number;
}

type Loader = (docPk: number) => Promise<PackedVectors | null>;

export class ScanPool {
  private workers: any[] = [];
  private workerBytes: number[] = [];
  private resident = new Map<number, Resident>();
  /** In-process fallback storage. */
  private local = new Map<number, PackedVectors>();
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private nextId = 1;
  private tick = 0;
  private started = false;
  /** Timings of the last search (ms), for reports. */
  last = { load: 0, scan: 0, loadedDocs: 0, workers: 0 };

  constructor(private limitBytes = DEFAULT_CACHE_MB * 1024 * 1024, private size = defaultSize()) {}

  setLimitMB(mb: number): void {
    this.limitBytes = Math.max(64, mb) * 1024 * 1024;
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    try {
      const Ctor = (globalThis as any).ChromeWorker || Zotero.getMainWindow?.()?.ChromeWorker;
      if (!Ctor) return;
      for (let i = 0; i < this.size; i++) {
        const w = new Ctor(WORKER_URL);
        w.onmessage = (e: MessageEvent) => this.onMessage(e.data);
        w.onerror = (e: any) => {
          e?.preventDefault?.();
          this.fail(`search worker: ${e?.message || e}`);
        };
        this.workers.push(w);
        this.workerBytes.push(0);
      }
    } catch (e) {
      // Fallback: scan in-process.
      logError(e);
      this.workers = [];
    }
  }

  get usesWorkers(): boolean {
    this.start();
    return this.workers.length > 0;
  }

  private onMessage(m: any): void {
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error));
    else p.resolve(m);
  }

  private request(worker: number, msg: any): Promise<any> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.workers[worker].postMessage({ ...msg, id }, [msg.query.buffer]);
    });
  }

  private bytesOf(v: PackedVectors): number {
    return v.matrix.byteLength + v.chunkPks.byteLength + v.scales.byteLength;
  }

  private totalBytes(): number {
    let t = 0;
    for (const r of this.resident.values()) t += r.bytes;
    return t;
  }

  private evict(keep: Set<number>, need: number): void {
    const byAge = [...this.resident].filter(([pk]) => !keep.has(pk)).sort((a, b) => a[1].used - b[1].used);
    for (const [pk] of byAge) {
      if (this.totalBytes() + need <= this.limitBytes) break;
      this.drop(pk);
    }
  }

  private drop(docPk: number): void {
    const r = this.resident.get(docPk);
    if (!r) return;
    this.resident.delete(docPk);
    if (this.workers.length) {
      this.workerBytes[r.worker] -= r.bytes;
      this.workers[r.worker].postMessage({ type: 'drop', docPk });
    } else {
      this.local.delete(docPk);
    }
  }

  private place(docPk: number, v: PackedVectors): void {
    const bytes = this.bytesOf(v);
    if (this.workers.length) {
      let w = 0;
      for (let i = 1; i < this.workers.length; i++) if (this.workerBytes[i] < this.workerBytes[w]) w = i;
      this.workerBytes[w] += bytes;
      this.workers[w].postMessage(
        { type: 'load', docPk, dims: v.dims, chunkPks: v.chunkPks, scales: v.scales, matrix: v.matrix },
        [v.chunkPks.buffer, v.scales.buffer, v.matrix.buffer],
      );
      this.resident.set(docPk, { worker: w, bytes, used: ++this.tick });
    } else {
      this.local.set(docPk, v);
      this.resident.set(docPk, { worker: -1, bytes, used: ++this.tick });
    }
  }

  /** Best `k` candidates over `docPks`; `load` supplies vectors of PDFs not resident yet. */
  async search(query: Float32Array, docPks: number[], k: number, load: Loader): Promise<{ id: number; score: number }[]> {
    this.start();
    this.last = { load: 0, scan: 0, loadedDocs: 0, workers: this.workers.length };
    const parts: { ids: Int32Array; scores: Float32Array }[] = [];
    // Resident PDFs first (no loading). A turn loads PDFs until the memory limit is
    // reached, scans them, and the next turn may evict them again (scope > limit).
    const todo = [...docPks].sort((a, b) => Number(this.resident.has(b)) - Number(this.resident.has(a)));
    let carry: { pk: number; v: PackedVectors } | null = null;
    while (todo.length || carry) {
      const t0 = Date.now();
      const keep = new Set<number>();
      while (todo.length || carry) {
        let pk: number;
        let v: PackedVectors | null;
        if (carry) {
          ({ pk, v } = carry);
          carry = null;
        } else {
          pk = todo.shift()!;
          const r = this.resident.get(pk);
          if (r) {
            r.used = ++this.tick;
            keep.add(pk);
            continue;
          }
          v = await load(pk);
          if (!v || !v.chunkPks.length) continue;
        }
        const size = this.bytesOf(v!);
        this.evict(keep, size);
        if (this.totalBytes() + size > this.limitBytes && keep.size) {
          carry = { pk, v: v! };
          break;
        }
        this.place(pk, v!);
        this.last.loadedDocs++;
        keep.add(pk);
        await Zotero.Promise.delay(0);
      }
      this.last.load += Date.now() - t0;
      const t1 = Date.now();
      parts.push(...await this.scan(query, [...keep], k));
      this.last.scan += Date.now() - t1;
    }
    return mergeTopK(parts, k);
  }

  private async scan(query: Float32Array, docPks: number[], k: number): Promise<{ ids: Int32Array; scores: Float32Array }[]> {
    if (!docPks.length) return [];
    if (!this.workers.length) {
      const out: { ids: Int32Array; scores: Float32Array }[] = [];
      for (const pk of docPks) {
        const v = this.local.get(pk);
        if (v) out.push(scanTopK(query, [v], k));
        await Zotero.Promise.delay(0);
      }
      return out;
    }
    const perWorker = this.workers.map(() => [] as number[]);
    for (const pk of docPks) perWorker[this.resident.get(pk)!.worker].push(pk);
    const replies = await Promise.all(perWorker.map((pks, w) =>
      pks.length ? this.request(w, { type: 'search', query: query.slice(), docPks: pks, k }) : null));
    const out: { ids: Int32Array; scores: Float32Array }[] = [];
    for (const r of replies) {
      if (!r) continue;
      if (r.missing?.length) throw new Error(`search worker lost ${r.missing.length} PDF(s)`);
      out.push({ ids: r.ids, scores: r.scores });
    }
    return out;
  }

  invalidate(docPk?: number): void {
    if (docPk !== undefined) {
      this.drop(docPk);
      return;
    }
    this.resident.clear();
    this.local.clear();
    this.workerBytes = this.workerBytes.map(() => 0);
    for (const w of this.workers) w.postMessage({ type: 'clear' });
  }

  /**
   * A worker died: its resident vectors are gone and it will never answer.
   * Pending searches fail instead of waiting forever; the next search starts fresh workers.
   */
  private fail(message: string): void {
    logError(message);
    this.terminate(new Error(`${message} (search restarted)`));
  }

  terminate(reason: Error = new Error('search workers stopped')): void {
    for (const w of this.workers) w.terminate();
    for (const p of this.pending.values()) p.reject(reason);
    this.pending.clear();
    this.workers = [];
    this.workerBytes = [];
    this.resident.clear();
    this.local.clear();
    this.started = false;
  }

  stats(): { docs: number; bytes: number; workers: number; limit: number } {
    return { docs: this.resident.size, bytes: this.totalBytes(), workers: this.workers.length, limit: this.limitBytes };
  }
}

function defaultSize(): number {
  let cores = 4;
  try {
    cores = Number(Zotero.getMainWindow?.()?.navigator?.hardwareConcurrency) || 4;
  } catch {
    // unit tests
  }
  return Math.max(1, Math.min(4, Math.floor(cores / 2)));
}

/** Loads packed vectors; PDFs indexed before schema 2 are packed from their chunks once and stored. */
export async function loadDocVectors(store: Store, docPk: number): Promise<PackedVectors | null> {
  const packed = await store.docVectors(docPk);
  if (packed) return packed;
  const rows = await store.queryArrays(
    `SELECT chunk_pk, ${store.vectorColumn('embedding_q')}, scale FROM chunks WHERE doc_pk = ? ORDER BY idx`, [docPk]);
  if (!rows.length) return null;
  const vectors = rows.map((r) => store.decodeVector(r[1]));
  const dims = vectors[0].length;
  const matrix = new Uint8Array(dims * vectors.length);
  vectors.forEach((v, i) => matrix.set(v.subarray(0, dims), i * dims));
  const p = unpackVectors(
    dims, rows.length,
    new Uint8Array(Int32Array.from(rows.map((r) => r[0] as number)).buffer),
    new Uint8Array(Float32Array.from(rows.map((r) => r[2] as number)).buffer),
    matrix,
  );
  try {
    await store.backfillDocVectors(docPk, p);
  } catch (e) {
    logError(e);
  }
  return p;
}
