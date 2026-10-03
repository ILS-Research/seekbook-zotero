import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePages, qualifiesSync } from '../src/core/eligibility';

const item = (itemType: string, numPages = '') => ({ isRegularItem: () => true, itemType, getField: () => numPages });

test('page field is parsed', () => {
  assert.equal(parsePages('312'), 312);
  assert.equal(parsePages('312 S.'), 312);
  assert.equal(parsePages(''), null);
  assert.equal(parsePages('xii'), null);
});

test('books always qualify, other items from the page threshold', () => {
  assert.equal(qualifiesSync(item('book'), 0), true);
  assert.equal(qualifiesSync(item('report', '45'), 0), false);
  assert.equal(qualifiesSync(item('report', '45'), 30), true);
  assert.equal(qualifiesSync(item('report', '12'), 30), null);
  assert.equal(qualifiesSync(item('report'), 30), null);
  assert.equal(qualifiesSync({ isRegularItem: () => false }, 30), false);
});
