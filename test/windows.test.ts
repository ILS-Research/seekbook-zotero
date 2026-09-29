import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinPages, makeWindows, pageAt } from '../src/core/text/windows';

function sentences(n: number, from = 0): string {
  return Array.from({ length: n }, (_, i) => `Satz ${from + i} hat genau sieben Wörter hier.`).join(' ');
}

test('windows overlap, cover all words and snap to sentences', () => {
  const pages = [1, 2, 3, 4].map((p) => ({ pageNumber: p, text: sentences(30, p * 100) }));
  const ws = makeWindows(pages, 50, 30);
  const total = pages.reduce((s, p) => s + p.text.split(' ').length, 0);
  assert.ok(ws.length >= Math.floor(total / 30) - 1, `windows: ${ws.length}`);
  for (const w of ws) {
    assert.ok(w.text.startsWith('Satz'), w.text.slice(0, 20));
    assert.ok(w.text.endsWith('hier.'), w.text.slice(-20));
    assert.ok(w.pageStart <= w.pageEnd);
  }
  for (let i = 1; i < ws.length; i++) {
    assert.ok(ws[i].charStart > ws[i - 1].charStart);
    assert.ok(ws[i].charStart <= ws[i - 1].charEnd, 'no gap');
  }
  assert.equal(ws[ws.length - 1].text.split(' ').pop(), 'hier.');
  assert.ok(ws.some((w) => w.pageEnd > w.pageStart), 'some window crosses a page break');
});

test('text without sentence ends still gets windows', () => {
  const words = Array.from({ length: 1000 }, (_, i) => `w${i}`).join(' ');
  const ws = makeWindows([{ pageNumber: 1, text: words }], 200, 120);
  assert.ok(ws.length >= 8);
  assert.equal(ws[0].text.split(' ').length, 200);
});

test('pageAt maps offsets to physical pages', () => {
  const j = joinPages([{ pageNumber: 3, text: 'aaa' }, { pageNumber: 5, text: 'bbb' }]);
  assert.equal(pageAt(j, 0), 3);
  assert.equal(pageAt(j, 4), 3);
  assert.equal(pageAt(j, 5), 5);
});

test('empty input gives no windows', () => {
  assert.deepEqual(makeWindows([], 200, 120), []);
});
