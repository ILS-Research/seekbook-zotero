import { test } from 'node:test';
import assert from 'node:assert/strict';
import { booksPayload, HttpError, isAllowedOrigin, parsePageRange, parseSearchParams } from '../src/core/rest';
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

test('books endpoint: searchable books of one library, optionally by key', async () => {
  const docs: Record<number, { status: string }[]> = {
    1: [{ status: 'ready' }, { status: 'queued' }], 2: [{ status: 'failed' }], 3: [{ status: 'ready' }],
  };
  const store: any = {
    books: async () => [
      { bookPk: 1, libraryKey: 'user', itemKey: 'A' },
      { bookPk: 2, libraryKey: 'user', itemKey: 'B' },
      { bookPk: 3, libraryKey: 'group:7', itemKey: 'C' },
    ],
    documents: async (pk: number) => docs[pk],
  };
  const all: any = await booksPayload(store, new URLSearchParams('libraryKey=user'));
  assert.deepEqual(all.books.map((b: any) => [b.itemKey, b.searchable, b.readyDocuments, b.queuedDocuments]), [['A', true, 1, 1], ['B', false, 0, 0]]);
  const some: any = await booksPayload(store, new URLSearchParams('libraryKey=user&itemKeys=B'));
  assert.deepEqual(some.books.map((b: any) => b.itemKey), ['B']);
  await assert.rejects(booksPayload(store, new URLSearchParams('libraryKey=x')), HttpError);
});
