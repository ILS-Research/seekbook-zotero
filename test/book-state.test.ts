import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookState } from '../src/core/book-state';

test('book state from PDF states', () => {
  assert.equal(bookState([]), null);
  assert.equal(bookState(['ready', 'duplicate', 'duplicate']), 'ready');
  assert.equal(bookState(['ready', 'excluded']), 'ready');
  assert.equal(bookState(['ready', 'failed']), 'partial');
  assert.equal(bookState(['ready', 'queued']), 'partial');
  assert.equal(bookState(['ready', 'indexing'], true), 'working');
  assert.equal(bookState(['queued', 'queued']), 'queued');
  assert.equal(bookState(['failed']), 'failed');
  assert.equal(bookState(['excluded']), 'excluded');
});
