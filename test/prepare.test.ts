import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  containment, embeddingText, findDuplicates, leadingNumber, NoTextError, orderDocuments, prepareDocument,
} from '../src/core/text/prepare';
import { outlineFromToc } from '../src/core/text/outline';
import { prose } from './fixtures/text';

const para = (_tag: string, n: number) => prose(n);

test('leading chapter numbers and reading order', () => {
  assert.equal(leadingNumber('Kapitel 3 – Methoden.pdf'), 3);
  assert.equal(leadingNumber('Kap. 10 Anhang'), 10);
  assert.equal(leadingNumber('Teil II'), 2);
  assert.equal(leadingNumber('02_Grundlagen'), 2);
  assert.equal(leadingNumber('Circular economy'), null);
  const docs = ['Kap. 10 Anhang', 'Gesamtausgabe', 'Kap. 2 Methoden', 'Kap. 1 Einleitung'].map((title, i) => ({
    key: `K${i}`, title, fileName: `${title}.pdf`, dateAdded: `2026-01-0${i + 1}`,
  }));
  assert.deepEqual(orderDocuments(docs).map((d) => d.title), ['Gesamtausgabe', 'Kap. 1 Einleitung', 'Kap. 2 Methoden', 'Kap. 10 Anhang']);
});

test('prepareDocument: chapters from bookmarks, document title in the path', () => {
  const pages = Array.from({ length: 6 }, (_, i) => ({ pageNumber: i + 1, text: para(`S${i}`, 12) }));
  const bookmarks = [
    { title: 'Einleitung', location: { position: { pageIndex: 0 } } },
    { title: 'Methoden', location: { position: { pageIndex: 3 } }, items: [{ title: 'Stichprobe', location: { position: { pageIndex: 4 } } }] },
  ];
  const p = prepareDocument(pages, { chunkWords: 40, strideWords: 25, bookmarks, docTitle: 'Teil 1.pdf' });
  assert.equal(p.outline.source, 'pdf');
  assert.equal(p.windows[0].chapter, 'Teil 1.pdf › Einleitung');
  const late = p.windows.find((w) => w.pageStart === 5)!;
  assert.equal(late.chapter, 'Teil 1.pdf › Methoden › Stichprobe');
  assert.throws(() => prepareDocument([{ pageNumber: 1, text: '' }]), NoTextError);
});

test('page blocks give no chapter path', () => {
  const pages = Array.from({ length: 3 }, (_, i) => ({ pageNumber: i + 1, text: para(`B${i}`, 5) }));
  const p = prepareDocument(pages, { chunkWords: 40, strideWords: 25 });
  assert.equal(p.outline.source, 'blocks');
  assert.equal(p.windows[0].chapter, '');
});

test('embedding text carries title and chapter', () => {
  assert.equal(embeddingText('Buch', 'Kap 1', 'Text', ''), 'Buch — Kap 1\nText');
  assert.equal(embeddingText('Buch', '', 'Text', 'search_document: '), 'search_document: Buch\nText');
});

test('printed TOC mapped to physical pages by offset', () => {
  const pages = Array.from({ length: 12 }, (_, i) => ({ pageNumber: i + 1, text: para(`P${i}`, 3) }));
  pages[1] = { pageNumber: 2, text: 'Inhalt\nEinleitung ..... 1\nMethoden ..... 4\nErgebnisse ..... 8' };
  pages[2].text = 'Einleitung ' + pages[2].text;
  pages[5].text = 'Methoden ' + pages[5].text;
  pages[9].text = 'Ergebnisse ' + pages[9].text;
  const o = outlineFromToc([pages[1]], pages)!;
  assert.equal(o.source, 'toc');
  assert.deepEqual(o.nodes.map((n) => [n.title, n.pageStart]), [['Einleitung', 3], ['Methoden', 6], ['Ergebnisse', 10]]);
  const withLabels = outlineFromToc([pages[1]], pages, pages.map((_, i) => String(i)))!;
  // Label '1' points into the TOC itself and is dropped; '4' is physical page 5.
  assert.deepEqual(withLabels.nodes.map((n) => [n.title, n.pageStart]), [['Methoden', 5], ['Ergebnisse', 9]]);
});

test('duplicates: same hash, and chapter PDFs contained in the whole book', () => {
  const ch1 = para('Eins', 30);
  const ch2 = para('Zwei', 30);
  const whole = `${ch1} ${ch2}`;
  const win = (t: string) => { const w = t.split(' '); const out = []; for (let i = 0; i < w.length; i += 40) out.push(w.slice(i, i + 50).join(' ')); return out; };
  assert.ok(containment(win(ch1), whole) >= 0.99);
  assert.ok(containment(win(para('Drei', 20)), whole) < 0.2);
  const docs = [
    { key: 'whole', hash: 'h1', windows: win(whole), text: whole, words: whole.split(' ').length },
    { key: 'c1', hash: 'h2', windows: win(ch1), text: ch1, words: ch1.split(' ').length },
    { key: 'c2', hash: 'h3', windows: win(ch2), text: ch2, words: ch2.split(' ').length },
    { key: 'copy', hash: 'h2', windows: win(ch1), text: ch1, words: ch1.split(' ').length },
  ];
  const d = findDuplicates(docs, 'whole');
  assert.equal(d.get('copy'), 'c1');
  assert.equal(d.get('c1'), 'whole');
  assert.equal(d.get('c2'), 'whole');
  assert.ok(!d.has('whole'));
  const parts = findDuplicates(docs, 'parts');
  assert.ok(parts.has('whole'));
  assert.ok(!parts.has('c1') && !parts.has('c2'));
});
