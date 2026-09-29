/**
 * UI strings (settings pane only). English is the plugin's language, German a
 * translation of the same keys. The locale follows Zotero's UI language and can
 * be forced with the pref extensions.zotero.seekbook.locale ("en", "de").
 */

const EN = {
  'prefs.server': 'Embedding server',
  'prefs.provider': 'Interface',
  'prefs.providerOllama': 'Ollama (native /api/embed)',
  'prefs.providerOpenai': 'OpenAI-compatible (/v1/embeddings)',
  'prefs.baseUrl': 'Server URL',
  'prefs.apiKey': 'API key (optional)',
  'prefs.model': 'Model',
  'prefs.queryPrefix': 'Query prefix',
  'prefs.docPrefix': 'Document prefix',
  'prefs.test': 'Test connection',
  'prefs.testing': 'Asking the server …',
  'prefs.testOk': 'Connected: {dims} dimensions ({ms} ms).',
  'prefs.error': 'Error: {message}',
  'prefs.remoteHosts': 'Allowed remote hosts',
  'prefs.remoteOff': 'Only this computer is used for embeddings.',
  'prefs.remoteOn': 'Warning: the full text of all indexed books is sent to {hosts}.',
  'prefs.indexing': 'Index',
  'prefs.libraries': 'Libraries (empty = all)',
  'prefs.excludeTag': 'Exclusion tag',
  'prefs.autoIndex': 'Index new and changed books automatically',
  'prefs.chunkWords': 'Window length (words)',
  'prefs.strideWords': 'Window step (words)',
  'prefs.expertHint': 'Changing the model, the document prefix or the window settings rebuilds the whole index.',
  'prefs.preferDuplicates': 'Whole-book PDF and chapter PDFs',
  'prefs.preferWhole': 'Keep the whole-book PDF',
  'prefs.preferParts': 'Keep the chapter PDFs',
  'prefs.api': 'Access for other plugins and agents (REST /seekbook/*)',
  'prefs.status': 'Status',
  'prefs.indexNow': 'Index now',
  'prefs.pause': 'Pause',
  'prefs.rebuild': 'Rebuild index',
  'prefs.rebuildConfirm': 'Delete the whole index and build it again?',
  'prefs.counts': '{books} books ready ({docs} PDFs, {chunks} windows) · {queued} queued · {failed} failed · {dups} duplicates',
  'prefs.running': 'Indexing book {book} of {books}: {title} – window {chunk} of {chunks}',
  'prefs.paused': 'Paused.',
  'prefs.idle': 'Idle.',
  'prefs.lastError': 'Stopped: {message}',
  'prefs.needsRebuild': 'Model or window settings changed: the next run rebuilds the index.',
  'prefs.failedList': 'Failed PDFs',
  'prefs.none': 'none',
} as const;

export type Key = keyof typeof EN;

const DE: Record<Key, string> = {
  'prefs.server': 'Embedding-Server',
  'prefs.provider': 'Schnittstelle',
  'prefs.providerOllama': 'Ollama (nativ, /api/embed)',
  'prefs.providerOpenai': 'OpenAI-kompatibel (/v1/embeddings)',
  'prefs.baseUrl': 'Server-URL',
  'prefs.apiKey': 'API-Key (optional)',
  'prefs.model': 'Modell',
  'prefs.queryPrefix': 'Präfix für Anfragen',
  'prefs.docPrefix': 'Präfix für Dokumente',
  'prefs.test': 'Verbindung testen',
  'prefs.testing': 'Frage den Server …',
  'prefs.testOk': 'Verbunden: {dims} Dimensionen ({ms} ms).',
  'prefs.error': 'Fehler: {message}',
  'prefs.remoteHosts': 'Erlaubte entfernte Hosts',
  'prefs.remoteOff': 'Embeddings werden nur auf diesem Rechner berechnet.',
  'prefs.remoteOn': 'Achtung: Der Volltext aller indexierten Bücher geht an {hosts}.',
  'prefs.indexing': 'Index',
  'prefs.libraries': 'Bibliotheken (leer = alle)',
  'prefs.excludeTag': 'Ausschluss-Tag',
  'prefs.autoIndex': 'Neue und geänderte Bücher automatisch indexieren',
  'prefs.chunkWords': 'Fensterlänge (Wörter)',
  'prefs.strideWords': 'Versatz (Wörter)',
  'prefs.expertHint': 'Änderungen an Modell, Dokument-Präfix oder Fenstern bauen den ganzen Index neu auf.',
  'prefs.preferDuplicates': 'Gesamt-PDF und Kapitel-PDFs',
  'prefs.preferWhole': 'Gesamt-PDF behalten',
  'prefs.preferParts': 'Kapitel-PDFs behalten',
  'prefs.api': 'Zugriff für andere Plugins und Agenten (REST /seekbook/*)',
  'prefs.status': 'Status',
  'prefs.indexNow': 'Jetzt indexieren',
  'prefs.pause': 'Pause',
  'prefs.rebuild': 'Index neu aufbauen',
  'prefs.rebuildConfirm': 'Den ganzen Index löschen und neu aufbauen?',
  'prefs.counts': '{books} Bücher fertig ({docs} PDFs, {chunks} Fenster) · {queued} in Warteschlange · {failed} fehlgeschlagen · {dups} Dubletten',
  'prefs.running': 'Indexiere Buch {book} von {books}: {title} – Fenster {chunk} von {chunks}',
  'prefs.paused': 'Pausiert.',
  'prefs.idle': 'Bereit.',
  'prefs.lastError': 'Angehalten: {message}',
  'prefs.needsRebuild': 'Modell oder Fenster geändert: Der nächste Lauf baut den Index neu auf.',
  'prefs.failedList': 'Fehlgeschlagene PDFs',
  'prefs.none': 'keine',
};

let forced: 'en' | 'de' | null = null;

export function setLocale(locale: 'en' | 'de' | null): void {
  forced = locale;
}

export function currentLocale(): 'en' | 'de' {
  if (forced) return forced;
  let pref = '';
  let zotero = '';
  try {
    pref = String(Zotero.Prefs.get('seekbook.locale') || '');
    zotero = String(Zotero.locale || '');
  } catch {
    // unit tests: no Zotero
  }
  if (pref === 'de' || pref === 'en') return pref;
  return zotero.toLowerCase().startsWith('de') ? 'de' : 'en';
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  const table: Record<string, string> = currentLocale() === 'de' ? DE : EN;
  return (table[key] ?? EN[key]).replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m));
}
