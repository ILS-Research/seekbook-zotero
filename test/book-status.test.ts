import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBookStatus } from '../src/core/book-status';
import { setLocale } from '../src/i18n';

const doc = (docPk: number, status: any, extra: any = {}) => ({
  docPk, bookPk: 1, attachmentKey: `K${docPk}`, attachmentTitle: `Teil ${docPk}`, fileName: '', sortOrder: docPk,
  pages: 120, contentHash: 'h', duplicateOf: null, modelId: 'm', status, error: null, indexedAt: null, outlineSource: 'pdf', ...extra,
});
const idle = { bookPk: null, attachmentKey: null, running: false, paused: false, book: 0, books: 0, title: '', chunk: 0, chunks: 0, lastError: null };

test('status of a book being indexed, with ready, duplicate and failed PDFs', () => {
  setLocale('de');
  const text = formatBookStatus({
    title: 'Handbuch', bookPk: 1, booksAhead: 0, excludedTag: false, notABook: false,
    docs: [doc(1, 'ready'), doc(2, 'indexing'), doc(3, 'duplicate', { duplicateOf: 1 }), doc(4, 'failed', { error: 'OCR nötig' })],
    chunks: new Map([[1, 250]]),
    progress: { ...idle, running: true, bookPk: 1, attachmentKey: 'K2', chunk: 64, chunks: 300 },
  });
  assert.match(text, /gerade indexiert/);
  assert.match(text, /Teil 1: fertig – 120 Seiten, 250 Fenster, Kapitel: Lesezeichen/);
  assert.match(text, /Teil 2: wird indexiert – Fenster 64 von 300/);
  assert.match(text, /Teil 3: Dublette – enthalten in Teil 1/);
  assert.match(text, /Teil 4: fehlgeschlagen – OCR nötig/);
  setLocale(null);
});

test('not indexed, excluded, waiting', () => {
  setLocale('en');
  const base = { title: 'B', chunks: new Map(), progress: idle, bookPk: null, booksAhead: 0, excludedTag: false, notABook: false };
  assert.match(formatBookStatus({ ...base, docs: null }), /Not in the index/);
  assert.match(formatBookStatus({ ...base, docs: null, excludedTag: true }), /Excluded/);
  assert.match(formatBookStatus({ ...base, docs: [doc(1, 'queued')], bookPk: 1, booksAhead: 3, progress: { ...idle, running: true, bookPk: 9 } }), /3 books before it/);
  setLocale(null);
});
