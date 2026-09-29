import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bm25, mergePassages, overlapWords, ranked, rrf, TopK, type Hit } from '../src/core/ranking';

test('bm25 prefers rare terms and higher tf', () => {
  const s = bm25([
    { chunkPk: 1, term: 'rare', tf: 1, nterms: 100 },
    { chunkPk: 2, term: 'common', tf: 1, nterms: 100 },
    { chunkPk: 3, term: 'common', tf: 1, nterms: 100 },
    { chunkPk: 4, term: 'common', tf: 3, nterms: 100 },
  ], 10, 100);
  assert.ok(s.get(1)! > s.get(2)!);
  assert.ok(s.get(4)! > s.get(3)!);
  assert.deepEqual(ranked(s, 1), [1]);
});

test('rrf fuses by rank', () => {
  const f = rrf([[1, 2, 3], [3, 1]]);
  assert.deepEqual(ranked(f), [1, 3, 2]);
  assert.ok(Math.abs(f.get(1)! - (1 / 61 + 1 / 62)) < 1e-12);
});

const hit = (chunkPk: number, docPk: number, idx: number, text: string, score: number, page = idx + 1): Hit => ({
  chunkPk, docPk, idx, pageStart: page, pageEnd: page, chapter: '', text, score, semanticScore: score, keywordScore: null,
});

test('neighbouring windows of one PDF merge into one passage', () => {
  const merged = mergePassages([
    hit(1, 1, 0, 'a b c d e f', 0.5),
    hit(2, 1, 1, 'd e f g h', 0.9, 2),
    hit(3, 1, 5, 'x y z', 0.7),
    hit(4, 2, 1, 'd e f g h', 0.8),
  ]);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].text, 'a b c d e f g h');
  assert.equal(merged[0].pageStart, 1);
  assert.equal(merged[0].pageEnd, 2);
  assert.equal(merged[0].score, 0.9);
  assert.deepEqual(merged[0].chunkPks, [1, 2]);
  assert.deepEqual(merged.map((m) => m.docPk), [1, 2, 1]);
  assert.equal(overlapWords(['a', 'b'], ['c']), 0);
});

test('TopK keeps the best', () => {
  const t = new TopK(3);
  [5, 1, 9, 3, 7, 2, 8].forEach((s, i) => t.push(i, s));
  assert.deepEqual(t.result().map((r) => r.score), [9, 8, 7]);
});
