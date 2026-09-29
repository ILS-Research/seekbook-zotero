import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanPages, isTocPage, parseTocEntries, stripRunningLines } from '../src/core/text/clean';
import { prose } from './fixtures/text';

const bodies = Array.from({ length: 12 }, () => prose(6));
const body = (i: number) => bodies[i];

test('running header with page number and footer are removed', () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({
    pageNumber: i + 1,
    text: `User documentation for JIRA 7.1 ${i + 12} ${body(i)} Licensed under Creative Commons`,
  }));
  const { pages: out, removed } = stripRunningLines(pages);
  assert.ok(removed.some((r) => r.startsWith('header: user documentation for jira #.# #')), removed.join('|'));
  assert.ok(removed.some((r) => r.startsWith('footer:') && r.includes('creative commons')), removed.join('|'));
  assert.equal(out[0].text, body(0));
});

test('odd/even headers are both found; unique starts stay', () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({
    pageNumber: i + 1,
    text: `${i % 2 ? 'Kapitel Methoden der Stadtklimaforschung' : 'Handbuch Stadtklima Band Zwei'} ${i + 1} ${body(i)}`,
  }));
  const { pages: out } = stripRunningLines(pages);
  for (const [i, p] of out.entries()) assert.equal(p.text, body(i));
  const fresh = Array.from({ length: 6 }, (_, i) => ({ pageNumber: i + 1, text: `Seite ${'abcdef'[i]}x beginnt anders. ${body(i)}` }));
  assert.deepEqual(stripRunningLines(fresh).removed, []);
});

test('TOC pages are detected and parsed', () => {
  const toc = 'Inhaltsverzeichnis\n1 Einleitung ........ 1\n2 Methoden ........ 5\n2.1 Stichprobe ........ 7\n3 Ergebnisse ........ 12\n4 Fazit ........ 20';
  assert.ok(isTocPage(toc));
  assert.ok(!isTocPage(body(1)));
  const e = parseTocEntries(toc);
  assert.deepEqual(e.map((x) => x.label), ['1', '5', '7', '12', '20']);
  assert.equal(e[1].title, '2 Methoden');
});

test('cleanPages skips TOC and nearly empty pages', () => {
  const pages = [
    { pageNumber: 1, text: 'Titel' },
    { pageNumber: 2, text: 'Contents\nIntro .... 3\nMethods .... 4\nResults .... 5\nOutlook .... 6\nIndex .... 7' },
    { pageNumber: 3, text: body(3) },
  ];
  const r = cleanPages(pages);
  assert.deepEqual(r.tocPages, [2]);
  assert.deepEqual(r.emptyPages, [1]);
  assert.deepEqual(r.pages.map((p) => p.pageNumber), [3]);
  assert.equal(r.stripped.length, 3);
});

test('a header does not swallow a body word that follows it on a few pages', () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({
    pageNumber: i + 1,
    text: `Handbuch Stadtklima ${i + 1} ${i % 3 === 0 ? 'Fassade ' : ''}${body(i)}`,
  }));
  const { pages: out, removed } = stripRunningLines(pages);
  assert.deepEqual(removed, ['header: handbuch stadtklima #']);
  assert.ok(out[0].text.startsWith('Fassade '), out[0].text.slice(0, 30));
});
