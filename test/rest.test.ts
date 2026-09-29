import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, isAllowedOrigin, parsePageRange, parseSearchParams } from '../src/core/rest';
import { parseSearchResponse } from './fixtures/seekchat-parse';

test('search parameters are validated', () => {
  const { q, opts } = parseSearchParams(new URLSearchParams('q=Stichprobe&topK=5&mode=keyword&itemKeys=A,B&expand=page&granularity=passages'));
  assert.equal(q, 'Stichprobe');
  assert.deepEqual(opts, { topK: 5, mode: 'keyword', itemKeys: ['A', 'B'], attachmentKeys: undefined, expand: 'page' });
  for (const bad of ['', 'q=x&topK=0', 'q=x&mode=fuzzy', 'q=x&libraryKey=foo', 'q=x&granularity=items']) {
    assert.throws(() => parseSearchParams(new URLSearchParams(bad)), (e: any) => e instanceof HttpError && e.status === 400, bad);
  }
});

test('page ranges', () => {
  assert.deepEqual(parsePageRange('45'), [45, 45]);
  assert.deepEqual(parsePageRange('10-12'), [10, 12]);
  assert.throws(() => parsePageRange('1-20'), HttpError);
  assert.throws(() => parsePageRange('5-3'), HttpError);
});

test('origin guard', () => {
  assert.ok(isAllowedOrigin(undefined));
  assert.ok(isAllowedOrigin('http://127.0.0.1:23119'));
  assert.ok(!isAllowedOrigin('https://evil.example'));
});

test("SeekChat's parser reads a SeekBook result unchanged", () => {
  const passages = parseSearchResponse({
    results: [{
      itemKey: 'ABCD1234', libraryKey: 'user', title: 'Buch', authors: ['A'], year: 2016, itemType: 'book',
      score: 0.03, semanticScore: 0.7, keywordScore: null, source: 'semantic',
      matchedChunk: { snippet: 'Text', page: 304, pageEnd: 305, pageLabel: '290', chapter: 'X', textSource: 'book', attachmentKey: 'EF', attachmentTitle: 'T', chunkIndex: 1 },
    }],
  });
  assert.equal(passages[0].page, 304);
  assert.equal(passages[0].text, 'Text');
  assert.equal(passages[0].textSource, 'book');
});
