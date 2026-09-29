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
  'prefs.testOk': 'Connected: {n} models on the server; {model} returns {dims} dimensions ({ms} ms).',
  'prefs.noModels': 'The server lists no models.',
  'prefs.notEmbedding': '(no embedding model?)',
  'prefs.error': 'Error: {message}',
  'prefs.remoteTitle': 'Allowed remote hosts (caution)',
  'prefs.remoteHelp': 'Without an entry SeekBook only talks to a server on this computer (127.0.0.1, localhost). ' +
    'Hosts listed here (comma-separated, without http:// and port, e.g. ollama.example.local) receive the full text ' +
    'of every indexed book, window by window, and every search query. Whoever runs or administers this host or can ' +
    'read its logs can read these contents; with http:// instead of https:// also anyone on the network in between. ' +
    'Only list hosts in your own, trusted network that may receive this data.',
  'prefs.remoteHosts': 'Allowed hosts:',
  'prefs.remoteOn': 'Allowed: {hosts}. Book text and search queries to these hosts leave this computer.',
  'prefs.remoteOff': 'No remote hosts allowed: SeekBook stays on this computer.',
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
  'prefs.testOk': 'Verbunden: {n} Modelle auf dem Server; {model} liefert {dims} Dimensionen ({ms} ms).',
  'prefs.noModels': 'Der Server nennt keine Modelle.',
  'prefs.notEmbedding': '(kein Embedding-Modell?)',
  'prefs.error': 'Fehler: {message}',
  'prefs.remoteTitle': 'Erlaubte entfernte Hosts (Vorsicht)',
  'prefs.remoteHelp': 'Ohne Eintrag spricht SeekBook nur mit einem Server auf diesem Rechner (127.0.0.1, localhost). ' +
    'Hier eingetragene Hosts (kommagetrennt, ohne http:// und Port, z. B. ollama.example.local) erhalten den ' +
    'Volltext aller indexierten Bücher (Fenster für Fenster) und jede Suchanfrage. Wer diesen Host betreibt, ' +
    'administriert oder seine Logs lesen kann, kann diese Inhalte lesen; bei http:// statt https:// zusätzlich jeder ' +
    'im Netzwerk dazwischen. Nur Hosts im eigenen, vertrauenswürdigen Netz eintragen, an die diese Daten gehen dürfen.',
  'prefs.remoteHosts': 'Erlaubte Hosts:',
  'prefs.remoteOn': 'Freigegeben: {hosts}. Buchtext und Suchanfragen an diese Hosts verlassen diesen Rechner.',
  'prefs.remoteOff': 'Keine entfernten Hosts freigegeben: SeekBook bleibt auf diesem Rechner.',
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
