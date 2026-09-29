/**
 * E2E scenarios, run in order inside a real Zotero against the mock embedding
 * server (e2e/mock-embed.mjs). Later scenarios use what earlier ones put in ctx.
 * Add new scenarios at the end of the list.
 */
import { readPages } from '../../src/core/indexer';
import { PATHS } from '../../src/core/rest';
import { scanPool } from '../../src/core/search';
import { ScanPool } from '../../src/core/scan-pool';
import { normalize, quantize, floatToBytes, int8ToBytes } from '../../src/core/embed/vectors';
import { readPdfStructure } from '../../src/core/text/pdf-outline';
import { prepareDocument } from '../../src/core/text/prepare';
import { setPref } from '../../src/prefs';
import { menuState, onAdd, onReindex } from '../../src/ui/context-menu';
import { parseSearchResponse } from '../fixtures/seekchat-parse';
import { assert, screenshot, waitFor, type E2EContext } from './harness';

type Scenario = [string, (ctx: E2EContext) => Promise<void>];

const MOCK = 'http://127.0.0.1:11434';

function plugin(): any {
  return Zotero.SeekBook;
}

async function mock(path: string, method = 'GET'): Promise<any> {
  const resp = await Zotero.getMainWindow().fetch(`${MOCK}${path}`, { method });
  return resp.json();
}

/** GET on Zotero's local server like another plugin would call it. */
async function api(path: string, params: Record<string, string> = {}): Promise<{ status: number; json: any }> {
  const url = `http://127.0.0.1:${Zotero.Server.port}${path}?${new URLSearchParams(params)}`;
  const resp = await Zotero.getMainWindow().fetch(url, { headers: { 'Zotero-Allowed-Request': '1' } });
  const text = await resp.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: resp.status, json };
}

async function writeReport(ctx: E2EContext, name: string, data: unknown): Promise<void> {
  await Zotero.File.putContentsAsync(`${ctx.outDir}/${name}`, JSON.stringify(data, null, 2));
}

async function newItem(type: string, title: string, tags: string[] = []): Promise<any> {
  const item = new Zotero.Item(type);
  item.libraryID = Zotero.Libraries.userLibraryID;
  item.setField('title', title);
  item.setCreators([{ creatorType: 'author', firstName: 'Erika', lastName: 'Muster' }]);
  if (type === 'book') item.setField('date', '2021');
  for (const tag of tags) item.addTag(tag);
  await item.saveTx();
  return item;
}

async function attach(ctx: E2EContext, parent: any, file: string, title: string): Promise<any> {
  return Zotero.Attachments.importFromFile({ file: `${ctx.fixturesDir}/${file}`, parentItemID: parent.id, title });
}

async function doc(attachment: any): Promise<any> {
  return plugin().store.documentByKey('user', attachment.key);
}

async function statusOf(attachment: any): Promise<string | undefined> {
  return (await doc(attachment))?.status;
}

export const scenarios: Scenario[] = [
  ['plugin is loaded', async () => {
    assert(plugin(), 'Zotero.SeekBook missing');
    assert(plugin().apiVersion === 1, 'apiVersion');
    assert(plugin().store.isOpen, 'store not open');
    for (const path of Object.values(PATHS)) assert(Zotero.Server.Endpoints[path], `endpoint ${path} missing`);
  }],

  ['SQLite capabilities (E3: FTS5, vector encoding)', async (ctx) => {
    const fts5 = await plugin().store.hasFts5();
    const encoding = await plugin().store.getMeta('vector_encoding');
    ctx.env = { fts5, vectorEncoding: encoding, zotero: Zotero.version };
    await writeReport(ctx, 'env-report.json', ctx.env);
    // Zotero 10 ships SQLite ≥ 3.41: vectors are real BLOBs via unhex().
    assert(encoding === 'hex', `encoding ${encoding}`);
    const typeofEmbedding = async () => (await plugin().store.query('SELECT typeof(embedding) AS t FROM chunks LIMIT 1'))[0]?.t;
    ctx.typeofEmbedding = typeofEmbedding;
  }],

  ['fixture library: book with whole PDF + 2 chapter PDFs, other book, article, excluded book', async (ctx) => {
    ctx.book = await newItem('book', 'Handbuch Stadtklima');
    ctx.whole = await attach(ctx, ctx.book, 'seekbook-whole.pdf', 'Gesamtausgabe');
    ctx.ch2 = await attach(ctx, ctx.book, 'seekbook-ch2.pdf', 'Kapitel 2 – Waermeinseln');
    ctx.ch1 = await attach(ctx, ctx.book, 'seekbook-ch1.pdf', 'Kapitel 1 – Starkregen');
    ctx.other = await newItem('book', 'Vulkane und Klima');
    ctx.otherPdf = await attach(ctx, ctx.other, 'seekbook-other.pdf', 'Vulkane');
    ctx.article = await newItem('journalArticle', 'Ein Artikel');
    ctx.articlePdf = await attach(ctx, ctx.article, 'seekbook-other.pdf', 'Artikel');
    ctx.excluded = await newItem('book', 'Ausgeschlossenes Buch', ['seekbook-exclude']);
    ctx.excludedPdf = await attach(ctx, ctx.excluded, 'seekbook-other.pdf', 'Ausgeschlossen');
    assert(ctx.book.getAttachments().length === 3, 'three attachments');
  }],

  ['text preparation (M1): header removed, TOC skipped, bookmarks, page labels', async (ctx) => {
    const report: any[] = [];
    for (const att of [ctx.whole, ctx.ch1, ctx.ch2, ctx.otherPdf]) {
      const pages = await readPages(att);
      const s = await readPdfStructure(att);
      const p = prepareDocument(pages, { bookmarks: s.outline, labels: s.labels, chunkWords: 200, strideWords: 120 });
      report.push({
        title: att.getField('title'), pages: p.pages, windows: p.windows.length, removed: p.removed, tocPages: p.tocPages,
        emptyPages: p.emptyPages, outline: p.outline.source, labels: s.labels, chapters: Array.from(new Set(p.windows.map((w) => w.chapter))),
      });
    }
    await writeReport(ctx, 'prep-report.json', report);
    const whole = report[0];
    assert(whole.removed.some((r: string) => r.includes('handbuch stadtklima #')), `header not removed: ${JSON.stringify(whole.removed)}`);
    assert(whole.tocPages.includes(2), `TOC page not skipped: ${JSON.stringify(whole.tocPages)}`);
    assert(whole.outline === 'pdf', `outline ${whole.outline}`);
    assert(whole.labels?.[0] === 'i' && whole.labels?.[2] === '1', `labels ${JSON.stringify(whole.labels)}`);
    assert(whole.chapters.some((c: string) => c.includes('Kapitel 2 Waermeinseln')), `chapters ${JSON.stringify(whole.chapters)}`);
    assert(report[3].outline !== 'pdf', 'other book has no bookmarks');
  }],

  ['index: whole PDF ready, chapter PDFs duplicates, article and excluded book skipped', async (ctx) => {
    const before = await mock('/__requests');
    await plugin().indexer.indexNow();
    assert(!plugin().indexer.progress.lastError, `indexer error: ${plugin().indexer.progress.lastError}`);
    const s = { whole: await statusOf(ctx.whole), ch1: await statusOf(ctx.ch1), ch2: await statusOf(ctx.ch2), other: await statusOf(ctx.otherPdf) };
    assert(s.whole === 'ready' && s.other === 'ready', `statuses ${JSON.stringify(s)}`);
    assert(s.ch1 === 'duplicate' && s.ch2 === 'duplicate', `statuses ${JSON.stringify(s)}`);
    assert((await doc(ctx.ch1)).duplicateOf === (await doc(ctx.whole)).docPk, 'duplicate_of points to the whole PDF');
    assert(!(await doc(ctx.articlePdf)), 'article indexed');
    assert((await statusOf(ctx.excludedPdf)) === 'excluded', 'excluded book');
    const after = await mock('/__requests');
    ctx.firstRunInputs = after.inputs - before.inputs;
    assert((await ctx.typeofEmbedding()) === 'blob', 'vectors not stored as BLOB');
    assert(ctx.firstRunInputs > 0, 'no embedding requests');
    // Sort order: whole first, then chapter 1, chapter 2.
    const docs = await plugin().store.documents((await doc(ctx.whole)).bookPk);
    assert(docs.map((d: any) => d.attachmentKey).join() === [ctx.whole.key, ctx.ch1.key, ctx.ch2.key].join(),
      `order ${docs.map((d: any) => d.attachmentTitle).join(' | ')}`);
  }],

  ['REST /seekbook/stats', async () => {
    const { status, json } = await api(PATHS.stats);
    assert(status === 200, `status ${status}`);
    assert(json.ready === true && json.indexedBooks === 2 && json.indexedDocuments === 2, JSON.stringify(json));
    assert(json.duplicateDocuments === 2 && json.dims === 64 && json.apiVersion === 1, JSON.stringify(json));
  }],

  ['REST /seekbook/search: ZotSeek shape, chapter, page label, filters', async (ctx) => {
    const { status, json } = await api(PATHS.search, { q: 'Stichprobe Messstationen', topK: '5' });
    assert(status === 200, `status ${status}: ${JSON.stringify(json)}`);
    assert(json.source === 'seekbook' && json.mode === 'hybrid', JSON.stringify(json).slice(0, 200));
    const top = json.results[0];
    assert(top?.itemKey === ctx.book.key && top.itemType === 'book', JSON.stringify(top).slice(0, 300));
    const m = top.matchedChunk;
    assert(m.attachmentKey === ctx.whole.key, `attachment ${m.attachmentKey}`);
    assert(m.snippet.includes('48 Messstationen'), m.snippet.slice(0, 200));
    assert(m.page >= 8 && m.page <= 12, `page ${m.page}`);
    assert(m.pageLabel === String(m.page - 2), `label ${m.pageLabel} for page ${m.page}`);
    assert(/Kapitel 2 Waermeinseln/.test(m.chapter), `chapter ${m.chapter}`);
    assert(!m.snippet.includes('Handbuch Stadtklima'), 'running header in the snippet');
    const parsed = parseSearchResponse(json);
    assert(parsed[0].page === m.page && parsed[0].text === m.snippet, "SeekChat's parser disagrees");
    // No duplicate hits from the chapter PDFs.
    assert(json.results.every((r: any) => r.matchedChunk.attachmentKey !== ctx.ch2.key), 'duplicate PDF searched');

    const kw = await api(PATHS.search, { q: 'Vulkane', mode: 'keyword' });
    assert(kw.json.results[0]?.itemKey === ctx.other.key && kw.json.results[0].keywordScore === 1, JSON.stringify(kw.json).slice(0, 300));
    const filtered = await api(PATHS.search, { q: 'Vulkane', itemKeys: ctx.book.key });
    assert(filtered.json.results.every((r: any) => r.itemKey === ctx.book.key), 'itemKeys filter');
    const byAtt = await api(PATHS.search, { q: 'Starkregen', attachmentKeys: ctx.otherPdf.key, mode: 'semantic' });
    assert(byAtt.json.results.every((r: any) => r.matchedChunk.attachmentKey === ctx.otherPdf.key), 'attachmentKeys filter');
    const expanded = await api(PATHS.search, { q: 'Stichprobe Messstationen', topK: '1', expand: 'page' });
    assert(expanded.json.results[0].matchedChunk.snippet.length >= m.snippet.length * 0.9, 'expand=page');
    assert((await api(PATHS.search, {})).status === 400, 'missing q');
    const denied = await Zotero.Server.Endpoints[PATHS.search].prototype.init({ headers: { origin: 'https://evil.example' }, searchParams: new URLSearchParams('q=x') });
    assert(denied[0] === 403, `foreign origin: ${denied[0]}`);
    ctx.pagePhysical = m.page;
  }],

  ['REST /seekbook/pages: cleaned text, page label lookup, errors', async (ctx) => {
    const r = await api(PATHS.pages, { attachmentKey: ctx.whole.key, pages: '3-4' });
    assert(r.status === 200 && r.json.pages.length === 2, JSON.stringify(r.json).slice(0, 200));
    assert(r.json.pages[0].label === '1' && r.json.pages[0].text.startsWith('Kapitel 1 Starkregen'), JSON.stringify(r.json.pages[0]).slice(0, 200));
    const byLabel = await api(PATHS.pages, { itemKey: ctx.book.key, pageLabel: '6' });
    assert(byLabel.status === 200 && byLabel.json.pages[0].page === 8, JSON.stringify(byLabel.json).slice(0, 200));
    assert((await api(PATHS.pages, { attachmentKey: ctx.ch1.key, pages: '1' })).status === 404, 'duplicate PDF has no pages');
    assert((await api(PATHS.pages, { attachmentKey: ctx.whole.key, pages: '1-20' })).status === 400, 'too many pages');
  }],

  ['JS interface Zotero.SeekBook', async (ctx) => {
    const res = await plugin().search('Waermeinseln', { topK: 3, mode: 'keyword' });
    assert(res.results.length && res.results[0].itemKey === ctx.book.key, JSON.stringify(res).slice(0, 200));
    assert((await plugin().stats()).indexedBooks === 2, 'stats');
    assert(await plugin().isIndexed('user', ctx.book.key), 'isIndexed book');
    assert(!(await plugin().isIndexed('user', ctx.article.key)), 'isIndexed article');
  }],

  ['queue: server outage keeps the PDF queued, restart resumes', async (ctx) => {
    await plugin().store.setStatus((await doc(ctx.otherPdf)).docPk, 'queued');
    await mock('/__fail?on=1', 'POST');
    try {
      await plugin().indexer.run();
    } finally {
      await mock('/__fail?on=0', 'POST');
    }
    assert(plugin().indexer.progress.lastError, 'no error reported');
    assert((await statusOf(ctx.otherPdf)) === 'queued', `status ${await statusOf(ctx.otherPdf)}`);
    // Plugin restart: the queue survives in the database and resumes by itself.
    const info = plugin().info;
    await plugin().shutdown();
    await plugin().startup(info);
    await waitFor('resumed indexing', async () => (await statusOf(ctx.otherPdf)) === 'ready', 30000);
  }],

  ['changed file ⇒ PDF indexed again', async (ctx) => {
    const path = await ctx.otherPdf.getFilePathAsync();
    const bytes = await Zotero.getMainWindow().IOUtils.read(`${ctx.fixturesDir}/seekbook-other2.pdf`);
    await Zotero.getMainWindow().IOUtils.write(path, bytes);
    const oldHash = (await doc(ctx.otherPdf)).contentHash;
    await plugin().indexer.syncBook(ctx.other);
    assert((await statusOf(ctx.otherPdf)) === 'queued', 'not queued after change');
    await plugin().indexer.run();
    const d = await doc(ctx.otherPdf);
    assert(d.status === 'ready' && d.contentHash !== oldHash, `status ${d.status}`);
    const r = await api(PATHS.search, { q: 'Pinatubo', mode: 'keyword' });
    assert(r.json.results[0]?.matchedChunk.snippet.includes('Pinatubo'), JSON.stringify(r.json).slice(0, 200));
  }],

  ['deleted attachment and trashed book are removed (notifier)', async (ctx) => {
    await ctx.ch2.eraseTx();
    await waitFor('chapter 2 row removed', async () => !(await doc(ctx.ch2)), 20000);
    await ctx.other.eraseTx();
    await waitFor('book removed', async () => !(await plugin().store.bookByKey('user', ctx.other.key)), 20000);
    assert(!(await doc(ctx.otherPdf)), 'PDF row of the deleted book');
  }],

  ['automatic indexing picks up a new book', async (ctx) => {
    setPref('autoIndex', true);
    try {
      ctx.auto = await newItem('book', 'Automatisch indexiert');
      ctx.autoPdf = await attach(ctx, ctx.auto, 'seekbook-other.pdf', 'Auto');
      await waitFor('auto-indexed', async () => (await statusOf(ctx.autoPdf)) === 'ready', 30000);
    } finally {
      setPref('autoIndex', false);
    }
  }],

  ['model change ⇒ rebuild with new dimensions', async (ctx) => {
    setPref('model', 'mock-embed-32');
    try {
      assert(await plugin().indexer.needsRebuild(), 'needsRebuild not reported');
      await plugin().indexer.indexNow();
      const stats = (await api(PATHS.stats)).json;
      assert(stats.dims === 32 && stats.indexedBooks === 2 && !stats.needsRebuild, JSON.stringify(stats));
      const r = await api(PATHS.search, { q: 'Waermeinseln Quartier', mode: 'semantic' });
      assert(r.status === 200 && r.json.results.length, JSON.stringify(r.json).slice(0, 200));
    } finally {
      setPref('model', 'mock-embed');
    }
    await plugin().indexer.indexNow();
    ctx.rebuilt = true;
  }],

  ['REST access can be switched off', async () => {
    setPref('apiEnabled', false);
    plugin().applyApiPref();
    try {
      assert(!Zotero.Server.Endpoints[PATHS.search], 'endpoint still registered');
    } finally {
      setPref('apiEnabled', true);
      plugin().applyApiPref();
    }
    assert(Zotero.Server.Endpoints[PATHS.search], 'endpoint not back');
  }],

  ['settings pane shows the index status', async (ctx) => {
    assert(plugin().paneID, 'no preference pane id');
    Zotero.Utilities.Internal.openPreferences(plugin().paneID);
    const prefsWin: any = await waitFor('preferences window', () => Services.wm.getMostRecentWindow('zotero:pref'), 10000);
    try {
      const counts = await waitFor('status cards', () => {
        const books = prefsWin.document.getElementById('seekbook-stat-books')?.textContent;
        const storage = prefsWin.document.getElementById('seekbook-stat-storage')?.textContent;
        return books === '2' && /\d (KB|MB)/.test(storage || '') ? `${books} / ${storage}` : null;
      }, 20000);
      const first = prefsWin.document.querySelector('#seekbook-preferences details');
      assert(first?.id === 'seekbook-group-status', `first group: ${first?.id}`);
      assert(/PDFs durchsuchbar/.test(prefsWin.document.getElementById('seekbook-counts').textContent), 'counts line');
      ctx.prefsCounts = counts;
      await screenshot(ctx, 'preferences', prefsWin);
      // Connection test fills the model dropdown from /api/tags, embedding models first.
      prefsWin.document.getElementById('seekbook-test').click();
      const status = await waitFor('connection test', () => {
        const el = prefsWin.document.getElementById('seekbook-test-status');
        return /Verbunden|Fehler/.test(el?.textContent || '') ? el.textContent : null;
      }, 10000);
      assert(status.includes('Verbunden: 3 Modelle') && status.includes('64 Dimensionen'), status);
      const options = Array.from(prefsWin.document.getElementById('seekbook-model').options).map((o: any) => o.value);
      assert(options.join() === 'mock-embed,mock-embed-32,llama3:8b', options.join());
      assert(prefsWin.document.querySelector('#seekbook-preferences .danger #seekbook-allowedRemoteHosts'), 'caution box');
    } finally {
      prefsWin.close();
    }
  }],

  ['assets report (real PDFs in test/assets, text preparation only)', async (ctx) => {
    const dir = Zotero.Prefs.get('seekbook.e2e.assetsDir');
    const IOUtils = Zotero.getMainWindow().IOUtils;
    const files: string[] = dir && (await IOUtils.exists(dir)) ? (await IOUtils.getChildren(dir)).filter((f: string) => f.endsWith('.pdf')) : [];
    const report: any[] = [];
    for (const file of files) {
      const book = await newItem('book', file.split('/').pop()!);
      const att = await Zotero.Attachments.importFromFile({ file, parentItemID: book.id });
      const t0 = Date.now();
      const pages = await readPages(att);
      const s = await readPdfStructure(att);
      const p = prepareDocument(pages, { bookmarks: s.outline, labels: s.labels, chunkWords: 200, strideWords: 120 });
      report.push({
        file, ms: Date.now() - t0, pages: p.pages, windows: p.windows.length, removed: p.removed, tocPages: p.tocPages,
        emptyPages: p.emptyPages.length, outline: p.outline.source, labels: s.labels ? `${s.labels[0]} … ${s.labels[s.labels.length - 1]}` : null,
        chapters: Array.from(new Set(p.windows.map((w) => w.chapter))).slice(0, 40),
        sample: p.windows.slice(10, 12).map((w) => ({ pages: `${w.pageStart}-${w.pageEnd}`, chapter: w.chapter, text: w.text.slice(0, 300) })),
      });
      await book.eraseTx();
    }
    await writeReport(ctx, 'assets-report.json', report);
  }],

  ['context menu: add a book, reindex it, show its status', async (ctx) => {
    const win = Zotero.getMainWindow();
    const book = await newItem('book', 'Buch aus dem Kontextmenü');
    const pdf = await attach(ctx, book, 'seekbook-other.pdf', 'Menü-PDF');
    win.Zotero_Tabs.select('zotero-pane');
    await win.ZoteroPane.collectionsView.selectLibrary(Zotero.Libraries.userLibraryID);
    await win.ZoteroPane.selectItems([book.id]);
    assert((Zotero as any).MenuManager, 'MenuManager missing in Zotero 10');
    const popup = win.document.getElementById('zotero-itemmenu');
    popup.openPopup(null, 'overlap', 0, 0, true, false);
    const add = await waitFor('add entry', () => popup.querySelector('[data-l10n-id="seekbook-menu-add"]'), 5000);
    assert(!add.hidden, 'add entry hidden for a new book');
    assert(popup.querySelector('[data-l10n-id="seekbook-menu-reindex"]')?.hidden, 'reindex shown for a new book');
    assert(!popup.querySelector('[data-l10n-id="seekbook-menu-info"]')?.hidden, 'info entry hidden');
    popup.hidePopup();
    assert(/nicht im Index/i.test(await plugin().bookStatusText(book)), await plugin().bookStatusText(book));

    // Automatic indexing is off: the menu still adds the book.
    await onAdd([book]);
    await waitFor('book indexed from the menu', async () => (await statusOf(pdf)) === 'ready', 30000);
    let state = menuState([book]);
    assert(!state.add && state.reindex && state.info, JSON.stringify(state));
    const text = await plugin().bookStatusText(book);
    assert(/Menü-PDF: fertig – 4 Seiten, \d+ Fenster/.test(text), text);

    const before = (await doc(pdf)).indexedAt;
    await onReindex([book]);
    await waitFor('book indexed again', async () => { const d = await doc(pdf); return d.status === 'ready' && d.indexedAt !== before; }, 30000);

    // Articles get no entries.
    state = menuState([ctx.article]);
    assert(!state.add && !state.reindex && !state.info, `article: ${JSON.stringify(state)}`);
  }],

  ['item tree column "SeekBook" shows the book state', async (ctx) => {
    const col = plugin().column;
    const keys = Zotero.ItemTreeManager.getCustomColumns?.().map((c: any) => c.dataKey) || [];
    assert(keys.some((k: string) => k.includes('seekbook-index-status')), `column not registered: ${keys.join()}`);
    const cols = Zotero.getMainWindow().ZoteroPane.itemsView.tree._columns.getAsArray();
    const mine = cols.find((c: any) => String(c.dataKey).includes('seekbook-index-status'));
    assert(mine && !mine.hidden && Zotero.Prefs.get('seekbook.columnShown'), 'column not shown on first install');
    await col.reload();
    assert(col.cellText(ctx.book) === '✓', `book: '${col.cellText(ctx.book)}'`);
    assert(col.cellText(ctx.excluded) === '⊘', `excluded: '${col.cellText(ctx.excluded)}'`);
    assert(col.cellText(ctx.article) === '', 'article has no glyph');
    assert(col.cellText(ctx.whole) === '', 'attachment row has no glyph');
    const fresh = await newItem('book', 'Noch nicht im Index');
    await attach(ctx, fresh, 'seekbook-other.pdf', 'X');
    await col.reload();
    assert(col.cellText(fresh) === '', 'unknown book has no glyph');
  }],

  ['chapter boundaries at character level (bookmark y position, mid-page section)', async (ctx) => {
    const d = await doc(ctx.whole);
    // Plain objects: Zotero's row proxies cannot be serialized.
    const rows = (await plugin().store.query('SELECT title, page_start, char_start, how FROM outline WHERE doc_pk = ? ORDER BY char_start', [d.docPk]))
      .map((r: any) => ({ title: r.title, page_start: r.page_start, char_start: r.char_start, how: r.how }));
    const sec = rows.find((r: any) => r.title === '2.2 Stadtbaeume und Schatten');
    assert(sec && sec.page_start === 10 && sec.how === 'text', `section row: ${JSON.stringify(rows.map((r: any) => [r.title, r.page_start, r.char_start, r.how]))}`);
    const chunks = (await plugin().store.query('SELECT idx, chapter, text, page_start, page_end FROM chunks WHERE doc_pk = ? ORDER BY idx', [d.docPk]))
      .map((r: any) => ({ idx: r.idx, chapter: r.chapter, text: r.text, page_start: r.page_start, page_end: r.page_end }));
    const inSection = chunks.filter((c: any) => c.text.includes('Stadtbaeume spenden Schatten'));
    assert(inSection.length && inSection.every((c: any) => c.chapter.endsWith('2.2 Stadtbaeume und Schatten')), JSON.stringify(inSection.map((c: any) => c.chapter)));
    // The text before the heading on page 10 still belongs to "Messungen", and no window crosses the boundary.
    const before = chunks.filter((c: any) => c.page_end === 10 && c.chapter.endsWith('Messungen'));
    assert(before.length, `no "Messungen" window ends on page 10: ${JSON.stringify(chunks.map((c: any) => [c.idx, c.page_start, c.page_end, c.chapter]))}`);
    assert(before.every((c: any) => !c.text.includes('Stadtbaeume spenden')), 'a window crosses the section start');
    await writeReport(ctx, 'chapters-report.json', { outline: rows, windows: chunks.map((c: any) => ({ idx: c.idx, pages: `${c.page_start}-${c.page_end}`, chapter: c.chapter, start: c.text.slice(0, 60) })) });
  }],

  ['status window updates live while the book is reindexed', async (ctx) => {
    setPref('batchSize', 4);
    await mock('/__delay?ms=150', 'POST');
    try {
      const win: any = plugin().statusWindows.show(ctx.book);
      const body = await waitFor('status window', () => (win.document?.getElementById('seekbook-status-body')?.textContent?.includes('fertig') ? win.document.getElementById('seekbook-status-body') : null), 10000);
      assert(/Gesamtausgabe: fertig/.test(body.textContent), body.textContent);
      win.document.getElementById('seekbook-status-reindex').click();
      const bar = await waitFor('progress bar in the open window', () => body.querySelector('progress'), 15000);
      const first = Number(bar.value);
      await waitFor('progress moves on', () => { const b = body.querySelector('progress'); return b && Number(b.value) > first; }, 15000);
      await waitFor('ready again', () => !body.querySelector('progress') && /Gesamtausgabe: fertig/.test(body.textContent), 30000);
      assert(/Aktualisiert/.test(win.document.getElementById('seekbook-status-updated').textContent), 'no update time');
      win.close();
    } finally {
      setPref('batchSize', 32);
      await mock('/__delay?ms=0', 'POST');
    }
  }],

  ['performance: 4096 dimensions, writing, cold and warm search in workers, UI responsiveness', async (ctx) => {
    const store = plugin().store;
    const DOCS = 8;
    const WINDOWS = 1000;
    const DIMS = 4096;
    const report: any = { docs: DOCS, windowsPerDoc: WINDOWS, dims: DIMS, write: [] };
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
    const itemKeys: string[] = [];
    const bookPks: number[] = [];
    try {
      for (let d = 0; d < DOCS; d++) {
        const itemKey = `PERF${String(d).padStart(4, '0')}`;
        itemKeys.push(itemKey);
        const bookPk = await store.upsertBook({ libraryKey: 'user', itemKey, title: `Perf ${d}`, authors: [], year: null, language: '' });
        bookPks.push(bookPk);
        const row = await store.upsertDocument({ bookPk, attachmentKey: `PERFATT${d}`, attachmentTitle: 'perf.pdf', fileName: 'perf.pdf', sortOrder: 0 });
        const chunks = Array.from({ length: WINDOWS }, (_, i) => {
          const v = normalize(Array.from({ length: DIMS }, rnd));
          const { q, scale } = quantize(v);
          const text = `Fenster ${i} des Testbuchs ${d} mit einigen Woertern Messung${i % 50} Modell${i % 7}`;
          return { idx: i, pageStart: 1 + (i >> 2), pageEnd: 1 + (i >> 2), charStart: i * 100, charEnd: i * 100 + 90, chapter: 'Kapitel', text,
            embedding: floatToBytes(v), embeddingQ: int8ToBytes(q), scale, terms: new Map([[`messung${i % 50}`, 1], [`fenster`, 1]]), nterms: 10 };
        });
        const t0 = Date.now();
        await store.writeDocument(row.docPk, `perf${d}`, 'ollama:mock-embed-4096', { chunks, pages: [], labels: null, outline: [], outlineSource: 'blocks', pageCount: 250 });
        report.write.push(Date.now() - t0);
      }
      setPref('model', 'mock-embed-4096');
      const win = Zotero.getMainWindow();
      // Main-thread responsiveness: the largest gap between 10 ms ticks while a search runs.
      const measure = async (fn: () => Promise<any>) => {
        let last = Date.now();
        let maxGap = 0;
        let running = true;
        const tick = () => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now; if (running) win.setTimeout(tick, 10); };
        win.setTimeout(tick, 10);
        const t0 = Date.now();
        const r = await fn();
        running = false;
        return { ms: Date.now() - t0, maxGap, r };
      };
      scanPool.invalidate();
      const q = { q: 'Messung Modell Fenster', topK: '10', mode: 'semantic', itemKeys: itemKeys.join(',') };
      const cold = await measure(() => api(PATHS.search, q));
      const warm = await measure(() => api(PATHS.search, q));
      assert(cold.r.status === 200 && warm.r.json.results.length === 10, JSON.stringify(warm.r.json).slice(0, 200));
      report.search = { coldMs: cold.ms, warmMs: warm.ms, coldMaxUiGapMs: cold.maxGap, warmMaxUiGapMs: warm.maxGap, pool: scanPool.stats(), last: scanPool.last };
      // Same scope in-process (no workers), for comparison.
      const local = new ScanPool(1024 * 1024 * 1024, 0);
      const qv = normalize(Array.from({ length: DIMS }, rnd));
      const { loadDocVectors } = await import('../../src/core/scan-pool');
      const docPks = (await store.query('SELECT doc_pk FROM documents WHERE attachment_key LIKE ?', ['PERFATT%'])).map((r: any) => r.doc_pk);
      await local.search(qv, docPks, 200, (pk: number) => loadDocVectors(store, pk));
      const inProcess = await measure(() => local.search(qv, docPks, 200, (pk: number) => loadDocVectors(store, pk)));
      const inWorkers = await measure(() => scanPool.search(qv, docPks, 200, (pk: number) => loadDocVectors(store, pk)));
      report.scan200 = { inProcessMs: inProcess.ms, inProcessMaxUiGapMs: inProcess.maxGap, workersMs: inWorkers.ms, workersMaxUiGapMs: inWorkers.maxGap, workers: scanPool.stats().workers };
      local.terminate();
      const fileBytes = (await Zotero.getMainWindow().IOUtils.stat(Zotero.DataDirectory.getDatabase('seekbook'))).size;
      report.dbMB = Math.round(fileBytes / 1048576);
      await writeReport(ctx, 'perf-report.json', report);
      assert(scanPool.stats().workers > 0, 'no search workers');
      assert(warm.ms < 3000, `warm search took ${warm.ms} ms`);
      assert(inWorkers.maxGap < 250, `UI blocked ${inWorkers.maxGap} ms during a worker scan`);
    } finally {
      setPref('model', 'mock-embed');
      for (const pk of bookPks) await store.deleteBook(pk);
      scanPool.invalidate();
    }
  }],
];
