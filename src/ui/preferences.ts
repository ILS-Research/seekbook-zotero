/** Settings pane: fields <-> prefs, connection test, index status and controls. */
import { embed, isEmbeddingModelName, listModels } from '../core/embed/client';
import { parseAllowedHosts } from '../core/host-guard';
import { currentLocale, t, type Key } from '../i18n';
import { getPref, readPrefs, setPref } from '../prefs';
import { logError } from '../util/log';

/** What the pane needs from the plugin (keeps the UI free of store/indexer internals). */
export interface PaneBackend {
  counts(): Promise<Record<string, number>>;
  /** Size of seekbook.sqlite in bytes, model of the index, time of the last indexed PDF (ms). */
  details(): Promise<{ bytes: number | null; model: string; lastIndexed: number | null }>;
  failed(): Promise<{ title: string; error: string }[]>;
  progress(): { running: boolean; paused: boolean; book: number; books: number; title: string; chunk: number; chunks: number; lastError: string | null; warning: string | null };
  needsRebuild(): Promise<boolean>;
  indexNow(): void;
  pause(): void;
  rebuild(): void;
  onChange(fn: () => void): () => void;
  apiChanged(): void;
}

const TEXT_PREFS = ['baseUrl', 'apiKey', 'excludeTag', 'libraries', 'docPrefix'];
const INT_PREFS = ['chunkWords', 'strideWords', 'batchSize', 'embedConcurrency', 'cacheMB'];

export function onPrefsLoad(win: Window, backend: PaneBackend): void {
  const doc = win.document;
  for (const el of Array.from(doc.querySelectorAll('#seekbook-preferences [data-i18n]')) as HTMLElement[]) {
    el.textContent = t(el.dataset.i18n as Key);
  }
  const $ = <T extends HTMLElement>(id: string) => doc.getElementById(`seekbook-${id}`) as T | null;
  const setText = (id: string, text: string) => { const e = $(id); if (e) e.textContent = text; };

  for (const key of ['provider', 'preferDuplicates']) {
    const sel = $<HTMLSelectElement>(key);
    if (!sel) continue;
    sel.value = String(getPref(key) ?? '');
    sel.addEventListener('change', () => setPref(key, sel.value));
  }
  for (const key of TEXT_PREFS) {
    const input = $<HTMLInputElement>(key);
    if (!input) continue;
    input.value = String(getPref(key) ?? '');
    input.addEventListener('change', () => setPref(key, key === 'docPrefix' ? input.value : input.value.trim()));
  }
  const qp = $<HTMLTextAreaElement>('queryPrefix');
  if (qp) {
    qp.value = String(getPref('queryPrefix') ?? '');
    qp.addEventListener('change', () => setPref('queryPrefix', qp.value));
  }
  for (const key of INT_PREFS) {
    const input = $<HTMLInputElement>(key);
    if (!input) continue;
    input.value = String(getPref(key) ?? '');
    input.addEventListener('change', () => {
      const v = parseInt(input.value, 10);
      if (Number.isFinite(v)) setPref(key, v);
    });
  }
  for (const key of ['autoIndex', 'apiEnabled', 'allowInvalidCerts']) {
    const box = $<HTMLInputElement>(key);
    if (!box) continue;
    box.checked = !!getPref(key);
    box.addEventListener('change', () => {
      setPref(key, box.checked);
      if (key === 'apiEnabled') backend.apiChanged();
    });
  }

  const hosts = $<HTMLInputElement>('allowedRemoteHosts');
  const showHosts = (list: string[]) => setText('remote-status', list.length ? t('prefs.remoteOn', { hosts: list.join(', ') }) : t('prefs.remoteOff'));
  if (hosts) {
    const list = parseAllowedHosts(getPref('allowedRemoteHosts'));
    hosts.value = list.join(', ');
    showHosts(list);
    hosts.addEventListener('change', () => {
      const parsed = parseAllowedHosts(hosts.value);
      setPref('allowedRemoteHosts', parsed.join(','));
      hosts.value = parsed.join(', ');
      showHosts(parsed);
    });
  }

  // Model: dropdown filled from the server by "Test connection" (like SeekChat); embedding models first.
  const model = $<HTMLSelectElement>('model');
  const fillModels = (names: string[]) => {
    if (!model) return;
    const current = readPrefs().model;
    const all = current && !names.includes(current) ? [current, ...names] : names;
    model.replaceChildren(...all.map((n) => {
      const o = doc.createElementNS('http://www.w3.org/1999/xhtml', 'option') as HTMLOptionElement;
      o.value = n;
      o.textContent = isEmbeddingModelName(n) || n === current ? n : `${n} ${t('prefs.notEmbedding')}`;
      return o;
    }));
    if (current) model.value = current;
    else if (all.length) setPref('model', (model.value = all[0]));
  };
  fillModels([]);
  model?.addEventListener('change', () => setPref('model', model.value));

  $('test')?.addEventListener('click', async () => {
    setText('test-status', t('prefs.testing'));
    const t0 = Date.now();
    try {
      const names = await listModels(readPrefs());
      fillModels(names);
      const prefs = readPrefs();
      if (!prefs.model) throw new Error(t('prefs.noModels'));
      const [v] = await embed(prefs, [prefs.queryPrefix + 'test'], { retries: 0 });
      setText('test-status', t('prefs.testOk', { n: names.length, model: prefs.model, dims: v.length, ms: Date.now() - t0 }));
    } catch (e: any) {
      setText('test-status', t('prefs.error', { message: e?.message || e }));
    }
  });

  const refresh = async () => {
    try {
      const c = await backend.counts();
      const d = await backend.details();
      const locale = currentLocale() === 'de' ? 'de-DE' : 'en-US';
      setText('stat-books', (c.books || 0).toLocaleString(locale));
      setText('stat-chunks', (c.chunks || 0).toLocaleString(locale));
      setText('stat-storage', formatBytes(d.bytes));
      setText('stat-model', t('prefs.statModel', { model: d.model || '–' }));
      setText('stat-avg', t('prefs.statAvg', { n: c.books ? Math.round((c.chunks || 0) / c.books).toLocaleString(locale) : '–' }));
      setText('stat-last', t('prefs.statLast', { when: d.lastIndexed ? new Date(d.lastIndexed).toLocaleString(locale) : '–' }));
      setText('counts', t('prefs.counts', {
        docs: c.ready || 0, queued: (c.queued || 0) + (c.indexing || 0), failed: c.failed || 0, dups: c.duplicate || 0,
      }));
      const p = backend.progress();
      let line = p.running ? t('prefs.running', p as any) : p.lastError ? t('prefs.lastError', { message: p.lastError })
        : p.paused ? t('prefs.paused') : t('prefs.idle');
      if (await backend.needsRebuild()) line += ' ' + t('prefs.needsRebuild');
      if (p.warning) line += ' ' + p.warning;
      setText('progress', line);
      const list = $('failed');
      if (list) {
        const failed = await backend.failed();
        list.replaceChildren(...(failed.length ? failed : [{ title: t('prefs.none'), error: '' }]).map((f) => {
          const li = doc.createElementNS('http://www.w3.org/1999/xhtml', 'li');
          li.textContent = f.error ? `${f.title}: ${f.error}` : f.title;
          return li;
        }));
      }
    } catch (e) {
      logError(e);
    }
  };
  let pending = false;
  const off = backend.onChange(() => {
    if (pending) return;
    pending = true;
    void Zotero.Promise.delay(300).then(() => { pending = false; return refresh(); });
  });
  win.addEventListener('unload', off);
  $('refresh')?.addEventListener('click', () => void refresh());
  $('indexNow')?.addEventListener('click', () => { backend.indexNow(); void refresh(); });
  $('pause')?.addEventListener('click', () => { backend.pause(); void refresh(); });
  $('rebuild')?.addEventListener('click', () => {
    if (win.confirm(t('prefs.rebuildConfirm'))) backend.rebuild();
  });
  void refresh();
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '–';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i && v < 10 ? 1 : 0)} ${units[i]}`;
}
