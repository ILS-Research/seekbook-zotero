import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeTopK, scanTopK } from '../src/core/scan';
import { ScanPool } from '../src/core/scan-pool';
import { packVectors, unpackVectors, type PackedVectors } from '../src/core/store';
import { dot, normalize, quantize } from '../src/core/embed/vectors';

(globalThis as any).Zotero = { Promise: { delay: async () => {} }, getMainWindow: () => null };

let seed = 3;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
const vec = (dims: number) => normalize(Array.from({ length: dims }, rnd));

function doc(firstPk: number, n: number, dims: number, floats: Map<number, Float32Array>): PackedVectors {
  const rows = Array.from({ length: n }, (_, i) => {
    const f = vec(dims);
    floats.set(firstPk + i, f);
    const { q, scale } = quantize(f);
    return { chunkPk: firstPk + i, q: new Uint8Array(q.buffer), scale };
  });
  const p = packVectors(rows);
  return unpackVectors(p.dims, p.n, p.chunkPks, p.scales, p.matrix);
}

test('packed vectors round trip', () => {
  const floats = new Map<number, Float32Array>();
  const d = doc(100, 3, 8, floats);
  assert.deepEqual(Array.from(d.chunkPks), [100, 101, 102]);
  assert.equal(d.matrix.length, 24);
});

test('scan finds the same top candidates as exact float search', () => {
  const floats = new Map<number, Float32Array>();
  const docs = [doc(1, 300, 64, floats), doc(1000, 300, 64, floats)];
  const q = vec(64);
  const exact = [...floats].map(([id, f]) => ({ id, s: dot(q, f) })).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.id);
  const r = scanTopK(q, docs, 20);
  for (const id of exact) assert.ok(Array.from(r.ids).includes(id), `exact top hit ${id} missing from the int8 candidates`);
  assert.ok(r.scores[0] >= r.scores[19]);
  assert.throws(() => scanTopK(vec(32), docs, 5), /dimensions/);
  const merged = mergeTopK([scanTopK(q, [docs[0]], 5), scanTopK(q, [docs[1]], 5)], 5);
  assert.deepEqual(merged.map((m) => m.id), Array.from(scanTopK(q, docs, 5).ids));
});

test('pool without workers: loads lazily, keeps within the memory limit, scans oversized scopes in turns', async () => {
  const floats = new Map<number, Float32Array>();
  const docs = new Map([1, 2, 3, 4].map((pk) => [pk, doc(pk * 1000, 200, 64, floats)]));
  const bytesPerDoc = 200 * 64 + 200 * 8;
  const pool = new ScanPool(1, 1);
  (pool as any).limitBytes = bytesPerDoc * 2.5; // room for two PDFs
  let loads = 0;
  const load = async (pk: number) => { loads++; const d = docs.get(pk)!; return { ...d, matrix: d.matrix.slice(), chunkPks: d.chunkPks.slice(), scales: d.scales.slice() }; };
  const q = vec(64);
  const expected = Array.from(scanTopK(q, [...docs.values()], 10).ids);
  const got = await pool.search(q, [1, 2, 3, 4], 10, load);
  assert.deepEqual(got.map((g) => g.id), expected);
  assert.equal(loads, 4);
  assert.ok(pool.stats().bytes <= bytesPerDoc * 2.5, `over the limit: ${pool.stats().bytes}`);
  // Resident PDFs are not loaded again.
  loads = 0;
  await pool.search(q, [3, 4].filter((pk) => (pool as any).resident.has(pk)), 5, load);
  assert.equal(loads, 0);
  pool.invalidate();
  assert.equal(pool.stats().docs, 0);
});

test('parallel searches over scopes larger than the limit do not evict each other (M2)', async () => {
  const floats = new Map<number, Float32Array>();
  const docs = new Map([1, 2, 3, 4, 5, 6].map((pk) => [pk, doc(pk * 1000, 100, 32, floats)]));
  const pool = new ScanPool(1, 1);
  (pool as any).limitBytes = (100 * 32 + 100 * 8) * 2.5;
  const load = async (pk: number) => {
    await new Promise((r) => setImmediate(r));
    const d = docs.get(pk)!;
    return { ...d, matrix: d.matrix.slice(), chunkPks: d.chunkPks.slice(), scales: d.scales.slice() };
  };
  const qa = vec(32);
  const qb = vec(32);
  const scopeA = [1, 2, 3];
  const scopeB = [4, 5, 6];
  const expect = (q: Float32Array, scope: number[]) => Array.from(scanTopK(q, scope.map((pk) => docs.get(pk)!), 8).ids);
  const [a, b] = await Promise.all([pool.search(qa, scopeA, 8, load), pool.search(qb, scopeB, 8, load)]);
  assert.deepEqual(a.map((x) => x.id), expect(qa, scopeA));
  assert.deepEqual(b.map((x) => x.id), expect(qb, scopeB));
  // A failing search does not block the next one.
  await assert.rejects(pool.search(qa, [1], 8, async () => { throw new Error('db gone'); }), /db gone/);
  assert.equal((await pool.search(qa, [1], 3, load)).length, 3);
});
