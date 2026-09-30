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
  'prefs.allowInvalidCerts': 'Accept invalid certificate (self-signed, expired, other name)',
  'prefs.httpsHelp': 'With an API key, a server on another computer must be reached over https://, so the key and the book ' +
    'text are encrypted on the way. "Accept invalid certificate" adds an exception for that server until Zotero restarts; ' +
    'the connection stays encrypted, but SeekBook no longer checks who is at the other end.',
  'prefs.advanced': 'Advanced',
  'prefs.batchSize': 'Texts per request',
  'prefs.embedConcurrency': 'Parallel requests',
  'prefs.cacheMB': 'Search memory (MB)',
  'prefs.advancedHelp': 'Texts per request and parallel requests set the load on the embedding server while indexing ' +
    '(apply from the next book). Search memory holds the vectors of recently searched PDFs (4096 dimensions: ' +
    '≈ 4.5 MB per 1000 windows); applies from the next search.',
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
  'prefs.autoIndex': 'Index automatically: the whole library after startup, then new and changed books',
  'prefs.chunkWords': 'Window length (words)',
  'prefs.strideWords': 'Window step (words)',
  'prefs.expertHint': 'After changing the model, the document prefix or the window settings the whole index has to be rebuilt (Rebuild index); until then indexing is paused.',
  'prefs.preferDuplicates': 'Whole-book PDF and chapter PDFs',
  'prefs.preferWhole': 'Keep the whole-book PDF',
  'prefs.preferParts': 'Keep the chapter PDFs',
  'prefs.api': 'Access for other plugins and agents (REST /seekbook/*)',
  'prefs.status': 'Status',
  'prefs.indexNow': 'Index now',
  'prefs.pause': 'Pause',
  'prefs.rebuild': 'Rebuild index',
  'prefs.rebuildConfirm': 'Delete the whole index and build it again?',
  'prefs.counts': '{docs} PDFs searchable · {queued} queued · {failed} failed · {dups} duplicates',
  'prefs.statistics': 'Index statistics',
  'prefs.statBooks': 'Books indexed',
  'prefs.statChunks': 'Windows',
  'prefs.statStorage': 'Storage used',
  'prefs.statModel': 'Model: {model}',
  'prefs.statAvg': 'Avg: {n} windows/book',
  'prefs.statLast': 'Last indexed: {when}',
  'prefs.refresh': 'Refresh stats',
  'prefs.actions': 'Actions',
  'prefs.recommended': '✓ Recommended',
  'prefs.indexNowDesc': 'Indexes new and changed books in the selected libraries. Resumes safely from where it left off.',
  'prefs.rebuildDesc': 'Deletes the whole index and builds it again with the current settings (model, windows).',
  'prefs.running': 'Indexing book {book} of {books}: {title} – window {chunk} of {chunks}',
  'prefs.paused': 'Paused.',
  'prefs.idle': 'Idle.',
  'prefs.lastError': 'Stopped: {message}',
  'prefs.needsRebuild': 'Model or window settings changed: indexing is paused until you rebuild the index.',
  'prefs.failedList': 'Failed PDFs',
  'prefs.none': 'none',
  'status.dialogTitle': 'SeekBook – index status',
  'status.untitled': 'Untitled',
  'status.notABook': 'Only items of type "Book" are indexed by SeekBook.',
  'status.notIndexed': 'Not in the index. Use "Add to book index (SeekBook)" in the context menu.',
  'status.excludedBook': 'Excluded from the index (exclusion tag).',
  'status.runningNow': 'This book is being indexed right now.',
  'status.waiting': 'Waiting in the queue ({n} books before it).',
  'status.waitingStopped': 'Waiting in the queue; indexing is paused or stopped (Settings → SeekBook → Index now).',
  'status.summary': '{ready} of {total} files ready for search.',
  'status.queued': 'queued',
  'status.indexing': 'being indexed',
  'status.ready': 'ready',
  'status.failed': 'failed',
  'status.excluded': 'not indexed',
  'status.duplicate': 'duplicate',
  'status.readyDetail': '{pages} pages, {windows} windows, chapters: {outline}',
  'status.progress': 'window {chunk} of {chunks}',
  'status.duplicateOf': 'contained in {title}',
  'status.added': '{n} book(s) queued for SeekBook.',
  'status.reindexButton': 'Reindex',
  'status.updated': 'Updated {time}',
  'common.close': 'Close',
  'outline.pdf': 'bookmarks',
  'outline.toc': 'printed table of contents',
  'outline.headings': 'detected headings',
  'outline.blocks': 'none (page blocks)',
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
  'prefs.allowInvalidCerts': 'Ungültiges Zertifikat akzeptieren (selbstsigniert, abgelaufen, anderer Name)',
  'prefs.httpsHelp': 'Mit API-Key muss ein Server auf einem anderen Rechner per https:// angesprochen werden, damit Key und ' +
    'Buchtext verschlüsselt übertragen werden. „Ungültiges Zertifikat akzeptieren“ legt für diesen Server eine Ausnahme ' +
    'bis zum Neustart von Zotero an; die Verbindung bleibt verschlüsselt, aber SeekBook prüft nicht mehr, wer am anderen Ende ist.',
  'prefs.advanced': 'Erweitert',
  'prefs.batchSize': 'Texte pro Anfrage',
  'prefs.embedConcurrency': 'Parallele Anfragen',
  'prefs.cacheMB': 'Suchspeicher (MB)',
  'prefs.advancedHelp': 'Texte pro Anfrage und parallele Anfragen bestimmen die Last auf dem Embedding-Server beim Indexieren ' +
    '(gilt ab dem nächsten Buch). Der Suchspeicher hält die Vektoren zuletzt durchsuchter PDFs (4096 Dimensionen: ' +
    '≈ 4,5 MB pro 1000 Fenster); gilt ab der nächsten Suche.',
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
  'prefs.autoIndex': 'Automatisch indexieren: die ganze Bibliothek nach dem Start, danach neue und geänderte Bücher',
  'prefs.chunkWords': 'Fensterlänge (Wörter)',
  'prefs.strideWords': 'Versatz (Wörter)',
  'prefs.expertHint': 'Nach Änderungen an Modell, Dokument-Präfix oder Fenstern muss der ganze Index neu aufgebaut werden (Index neu aufbauen); bis dahin ruht die Indexierung.',
  'prefs.preferDuplicates': 'Gesamt-PDF und Kapitel-PDFs',
  'prefs.preferWhole': 'Gesamt-PDF behalten',
  'prefs.preferParts': 'Kapitel-PDFs behalten',
  'prefs.api': 'Zugriff für andere Plugins und Agenten (REST /seekbook/*)',
  'prefs.status': 'Status',
  'prefs.indexNow': 'Jetzt indexieren',
  'prefs.pause': 'Pause',
  'prefs.rebuild': 'Index neu aufbauen',
  'prefs.rebuildConfirm': 'Den ganzen Index löschen und neu aufbauen?',
  'prefs.counts': '{docs} PDFs durchsuchbar · {queued} in Warteschlange · {failed} fehlgeschlagen · {dups} Dubletten',
  'prefs.statistics': 'Index-Statistik',
  'prefs.statBooks': 'Bücher indexiert',
  'prefs.statChunks': 'Fenster',
  'prefs.statStorage': 'Speicher belegt',
  'prefs.statModel': 'Modell: {model}',
  'prefs.statAvg': 'Ø {n} Fenster/Buch',
  'prefs.statLast': 'Zuletzt indexiert: {when}',
  'prefs.refresh': 'Statistik aktualisieren',
  'prefs.actions': 'Aktionen',
  'prefs.recommended': '✓ Empfohlen',
  'prefs.indexNowDesc': 'Indexiert neue und geänderte Bücher der gewählten Bibliotheken. Setzt sicher dort fort, wo zuletzt aufgehört wurde.',
  'prefs.rebuildDesc': 'Löscht den ganzen Index und baut ihn mit den aktuellen Einstellungen (Modell, Fenster) neu auf.',
  'prefs.running': 'Indexiere Buch {book} von {books}: {title} – Fenster {chunk} von {chunks}',
  'prefs.paused': 'Pausiert.',
  'prefs.idle': 'Bereit.',
  'prefs.lastError': 'Angehalten: {message}',
  'prefs.needsRebuild': 'Modell oder Fenster geändert: Die Indexierung ruht, bis der Index neu aufgebaut wird.',
  'prefs.failedList': 'Fehlgeschlagene PDFs',
  'prefs.none': 'keine',
  'status.dialogTitle': 'SeekBook – Indexstatus',
  'status.untitled': 'Ohne Titel',
  'status.notABook': 'SeekBook indexiert nur Einträge vom Typ „Buch“.',
  'status.notIndexed': 'Nicht im Index. Über das Kontextmenü „Zum Buchindex hinzufügen (SeekBook)“ aufnehmen.',
  'status.excludedBook': 'Vom Index ausgeschlossen (Ausschluss-Tag).',
  'status.runningNow': 'Dieses Buch wird gerade indexiert.',
  'status.waiting': 'Wartet in der Warteschlange ({n} Bücher davor).',
  'status.waitingStopped': 'Wartet in der Warteschlange; die Indexierung ist pausiert oder angehalten (Einstellungen → SeekBook → Jetzt indexieren).',
  'status.summary': '{ready} von {total} Dateien durchsuchbar.',
  'status.queued': 'in Warteschlange',
  'status.indexing': 'wird indexiert',
  'status.ready': 'fertig',
  'status.failed': 'fehlgeschlagen',
  'status.excluded': 'nicht indexiert',
  'status.duplicate': 'Dublette',
  'status.readyDetail': '{pages} Seiten, {windows} Fenster, Kapitel: {outline}',
  'status.progress': 'Fenster {chunk} von {chunks}',
  'status.duplicateOf': 'enthalten in {title}',
  'status.added': '{n} Buch/Bücher für SeekBook eingereiht.',
  'status.reindexButton': 'Neu indexieren',
  'status.updated': 'Aktualisiert {time}',
  'common.close': 'Schließen',
  'outline.pdf': 'Lesezeichen',
  'outline.toc': 'gedrucktes Inhaltsverzeichnis',
  'outline.headings': 'erkannte Überschriften',
  'outline.blocks': 'keine (Seitenblöcke)',
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
