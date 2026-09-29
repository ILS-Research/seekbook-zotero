import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chapterStarts, findHeading, nearestSentenceStart, pathAt, titleVariants } from '../src/core/text/chapters';
import { outlineFromReader } from '../src/core/text/outline';
import { prepareDocument } from '../src/core/text/prepare';
import { joinPages, makeWindows } from '../src/core/text/windows';
import { prose } from './fixtures/text';

test('title variants: full, without numbering, first words', () => {
  assert.deepEqual(titleVariants('Kapitel 2: Wärmeinseln im dicht bebauten Quartier'),
    ['kapitel 2 wärmeinseln im dicht bebauten quartier', 'wärmeinseln im dicht bebauten quartier', 'wärmeinseln im dicht bebauten']);
  assert.deepEqual(titleVariants('3.2 Stichprobe'), ['3 2 stichprobe', 'stichprobe']);
});

test('heading in the middle of a page is found; the occurrence that starts a sentence and fits the position wins', () => {
  const text = 'Wie in Methoden beschrieben, gilt das. Ende des Kapitels. Methoden Die Stichprobe umfasst 48 Stationen.';
  const at = findHeading(text, '2 Methoden', 0.5)!;
  assert.equal(text.slice(at, at + 8), 'Methoden');
  assert.ok(at > 30);
  assert.equal(findHeading(text, 'Ergebnisse', null), null);
  assert.equal(text.slice(nearestSentenceStart(text, 60)).slice(0, 8), 'Methoden');
});

test('chapter starts at character level, never decreasing, deepest node wins at the same spot', () => {
  const p1 = `${prose(8)} Kapitel 2 Ergebnisse ${prose(8)}`;
  const p2 = `2.1 Messungen ${prose(12)}`;
  const pages = [{ pageNumber: 1, text: `Kapitel 1 Einleitung ${prose(10)}` }, { pageNumber: 2, text: p1 }, { pageNumber: 3, text: p2 }];
  const outline = outlineFromReader([
    { title: 'Kapitel 1 Einleitung', location: { position: { pageIndex: 0, top: 0 } } },
    { title: 'Kapitel 2 Ergebnisse', location: { position: { pageIndex: 1, top: 0.5 } },
      items: [{ title: 'Messungen', location: { position: { pageIndex: 2, top: 0 } } }] },
  ], pages)!;
  const joined = joinPages(pages);
  const starts = chapterStarts(outline, pages, joined);
  assert.deepEqual(starts.map((s) => s.how), ['text', 'text', 'text']);
  assert.equal(joined.text.slice(starts[1].charStart, starts[1].charStart + 9), 'Kapitel 2');
  assert.equal(joined.text.slice(starts[2].charStart, starts[2].charStart + 9), 'Messungen');
  assert.deepEqual(pathAt(starts, starts[1].charStart - 1), ['Kapitel 1 Einleitung']);
  assert.deepEqual(pathAt(starts, starts[2].charStart + 5), ['Kapitel 2 Ergebnisse', 'Messungen']);
});

test('windows never cross a chapter boundary; heading-only segments merge into the next', () => {
  const pages = [{ pageNumber: 1, text: `${prose(40)} Kapitel 2 Ergebnisse Kurz. ${prose(40)}` }];
  const b = pages[0].text.indexOf('Kapitel 2');
  const ws = makeWindows(pages, 120, 80, [b]);
  for (const w of ws) assert.ok(w.charEnd <= b || w.charStart >= b, `window ${w.idx} crosses the boundary`);
  assert.ok(ws.some((w) => w.charStart === b), 'a window starts exactly at the chapter');
  const tiny = makeWindows(pages, 120, 80, [b, b + 12]);
  assert.ok(!tiny.some((w) => w.charStart === b + 12), 'heading-only segment was not merged');
});

test('prepareDocument labels every window with the chapter it lies in (mid-page start, deep outline)', () => {
  const pages = Array.from({ length: 4 }, (_, i) => ({ pageNumber: i + 1, text: prose(25) }));
  pages[1].text = `${prose(12)} Kapitel 2 Ergebnisse ${prose(12)}`;
  pages[2].text = `2.1 Messungen ${prose(10)} 2.1.1 Stationen im Quartier ${prose(10)}`;
  const bookmarks = [
    { title: 'Kapitel 1 Einleitung', location: { position: { pageIndex: 0 } } },
    { title: 'Kapitel 2 Ergebnisse', location: { position: { pageIndex: 1, top: 0.5 } }, items: [
      { title: '2.1 Messungen', location: { position: { pageIndex: 2 } }, items: [
        { title: '2.1.1 Stationen im Quartier', location: { position: { pageIndex: 2, top: 0.5 } } }] }] },
  ];
  const p = prepareDocument(pages, { chunkWords: 60, strideWords: 40, bookmarks });
  const chaptersOf = (needle: string) => p.windows.filter((w) => w.text.includes(needle)).map((w) => w.chapter);
  assert.ok(p.windows.filter((w) => w.pageStart === 2 && w.chapter === 'Kapitel 1 Einleitung').length, 'first half of page 2 is chapter 1');
  assert.deepEqual(Array.from(new Set(chaptersOf('Stationen im Quartier'))), ['Kapitel 2 Ergebnisse › 2.1 Messungen › 2.1.1 Stationen im Quartier']);
  assert.equal(p.chapters.length, 4);
});
