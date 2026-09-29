# Code-Review SeekBook (v0.3.3)

- **Datum:** 29.09.2026
- **Reviewer:** Claude Opus 5.5
- **Grundlage:** nur der Quellcode. CLAUDE.md, READMEs, Changelog und Testlogs wurden bewusst nicht gelesen („NODOCS“).
- **Gelesen:** `src/**` (ohne Tests), `bootstrap.js`, `prefs.js`, `manifest.json`, `content/*.xhtml`, `locale/**`, `scripts/build.mjs`, `scripts/publish.py`, `build.sh`, `docker/Dockerfile`
- **Nicht gelesen:** `test/**`, `e2e/**`
- **Tests:** nicht ausgeführt. Das Node auf dem Host ist zu alt; der Build läuft in Docker über `build.sh`.

> **Status:** H1–H5 behoben in v0.3.4; M1, M3, M4, M5, M7–M10 in v0.3.5. H6 in v0.3.6; M2, M6 in v0.3.7. Offen: die Niedrig-Punkte.

## Gesamteindruck

Die Architektur ist sauber geschnitten. Die Kernlogik steckt in reinen, testbaren Modulen (`ranking`, `scan`, `text/*`, `book-state`), die Zotero-Anbindung ist dünn. Weitere Stärken:

- Die Queue hält ihren Zustand in der DB (`documents.status`) und übersteht so Neustarts.
- Die Suche ist zweistufig: Vorauswahl über int8-Vektoren in ChromeWorkern, danach genaues Nachbewerten mit float32.
- Der Host-Guard arbeitet mit `redirect: 'error'`.
- Die Textaufbereitung ist sorgfältig: Kopf- und Fußzeilen werden erkannt, Inhaltsverzeichnis-Seiten übersprungen, die Kapitelgliederung hat eine Fallback-Kette (Lesezeichen → Inhaltsverzeichnis → Überschriften → Seitenblöcke), Kapitelgrenzen werden auf Zeichen genau bestimmt.

Die Schwächen liegen fast alle bei **Nebenläufigkeit und Lebenszyklus**, dazu kommen einige **destruktive Automatismen**.

---

## Hoch

### ~~H1 Der ganze Index wird ohne Rückfrage gelöscht~~ — ✅ behoben in 0.3.4
[indexer.ts:129](src/core/indexer.ts#L129)

`checkConfig()` ruft `clearAll()` auf, sobald sich Modell, `chunkWords`, `strideWords` oder `docPrefix` geändert haben. Aufgerufen wird es aus `flushNotifications` ([index.ts:207](src/index.ts#L207)), aus `indexBooks` und aus `scan`.

**Folge:** Es reicht, nach einer Änderung an diesen Einstellungen ein beliebiges schon indiziertes Buch zu bearbeiten, und alle Embeddings sind weg. Das gilt auch bei `autoIndex=false`. Die Einstellungsseite fragt vor „Index neu aufbauen“ extra nach ([preferences.ts:159](src/ui/preferences.ts#L159)), dieser Schutz läuft hier ins Leere.

Das Risiko ist höher, als es aussieht:
- `fillModels` setzt das Modell von selbst, wenn keins gesetzt ist.
- Die Felder für die Fenstergröße schreiben bei jedem `change`.

**Vorschlag:** Nur `rebuild()` darf löschen. Bei abweichender Konfiguration pausieren alle anderen Wege und zeigen „needsRebuild“ an.

### ~~H2 `checkConfig()` greift in einen laufenden Durchlauf ein~~ — ✅ behoben in 0.3.4
`rebuild()` ruft vorher `stop()` auf, `checkConfig()` tut das nicht. Wird mitten im Durchlauf gelöscht, schreibt `processBook` mit seinen alten `docPk`s weiter. `writeDocument` legt dann Zeilen in `chunks`, `terms`, `pages` und `doc_vectors` für Dokumente an, die es nicht mehr gibt. Das abschließende `UPDATE documents` trifft keine Zeile. Die verwaisten Daten werden nie aufgeräumt.

### ~~H3 Suche mit dem falschen Modell~~ — ✅ behoben in 0.3.4
Nach einem Modellwechsel und vor dem Neuaufbau wird die Anfrage mit dem neuen Modell eingebettet und mit den alten Vektoren verglichen.

- Unterschiedlich viele Dimensionen: Fehlermeldung aus `scanTopK`.
- Gleich viele Dimensionen: stillschweigend unsinnige Treffer.

`needsRebuild` steht zwar in `/stats`, aber `search()` prüft es nicht.

**Vorschlag:** Vor der Suche `index_config` bzw. `model_id` vergleichen und mit 503 „needs rebuild“ antworten.

### ~~H4 Der Status `failed` bleibt hängen~~ — ✅ behoben in 0.3.4
[indexer.ts:227-236](src/core/indexer.ts#L227-L236)

Ablauf:
1. Ein PDF ist fertig indiziert (Hash H).
2. Die Datei fehlt kurz, etwa weil sie noch nicht synchronisiert ist. Das PDF bekommt `failed` mit „file missing“. Die Inhalte werden nicht gelöscht, `content_hash` bleibt H.
3. Die Datei taucht unverändert wieder auf. Die Bedingung `!(status==='failed' && hash===contentHash)` verhindert das erneute Einreihen.

**Folge:** Das Buch bleibt dauerhaft unsichtbar, obwohl die Daten noch in der DB liegen. Nur „Neu indexieren“ von Hand hilft.

**Vorschlag:** Bei „file missing“ `content_hash` leeren, oder beim Fehler eine Fehlerart mitspeichern, damit sich ein vorübergehender Fehler von einem echten unterscheiden lässt.

### ~~H5 `shutdown()` wird nicht abgewartet~~ — ✅ behoben in 0.3.4
[bootstrap.js](bootstrap.js) ruft `Zotero.SeekBook?.shutdown()` ohne `await` auf und macht direkt mit `delete` und `chromeHandle.destruct()` weiter.

**Folge:** Beim Update oder Deaktivieren startet die neue Version, während die alte noch einbettet und auf `seekbook.sqlite` schreibt: zwei DB-Verbindungen, zwei Indexer. H7 macht das schlimmer, weil `stop()` ohne Timeout beliebig lange hängen kann.

### ~~H6 REST: DNS-Rebinding und Prüfung des Origin-Headers~~ — ✅ behoben in 0.3.6
[rest.ts:32](src/core/rest.ts#L32)

- Fehlt der `Origin`-Header, wird die Anfrage zugelassen. Browser schicken bei same-origin-GETs keinen `Origin` mit.
- Eine Seite, deren Domain per DNS-Rebinding auf 127.0.0.1 zeigt, kann also `/seekbook/pages` und `/search` auslesen, also den Volltext der Bücher.
- Laut Kommentar im Dateikopf wird `Zotero-Allowed-Request` verlangt. Im Code wird dieser Header nirgends geprüft.

**Vorschlag:** den `Host`-Header gegen `127.0.0.1`, `localhost` und `[::1]` (mit Port) prüfen. Außerdem nachsehen, was `Zotero.Server` selbst schon abfängt.


**Umsetzung (0.3.6):** Zotero prüft den `Host`-Header selbst seit Commit `5dc817db4` (April 2026), ältere Zotero-7-Versionen nicht. SeekBook lehnt deshalb zusätzlich jeden `Host` außer `127.0.0.1`, `localhost` und `[::1]` mit 403 ab (`isAllowedHost` in rest.ts). Browser-Anfragen ohne `Zotero-Allowed-Request` verwirft Zotero schon vorher anhand von User-Agent bzw. Origin.

---

## Mittel

### ~~M1 Embedding-Anfragen haben kein Timeout und lassen sich nicht abbrechen~~ — ✅ behoben in 0.3.5
[client.ts:69](src/core/embed/client.ts#L69)

`signal` wird unterstützt, aber der Indexer übergibt keins. Hängt der Server, hängen auch `stop()`, `pause()`, `rebuild()` und der Shutdown. `newAbortController` ([env.ts](src/util/env.ts)) ist schon vorhanden, wird aber nirgends benutzt.

### ~~M2 ScanPool: Race zwischen parallelen Suchen~~ — ✅ behoben in 0.3.7
[scan-pool.ts:138](src/core/scan-pool.ts#L138)

`evict()` kennt nur das `keep`-Set der eigenen Suche. Eine zweite Suche, die gleichzeitig läuft, kann die gerade geladenen PDFs der ersten wieder verdrängen. Der Worker meldet sie dann als `missing`, und die erste Suche bricht mit „search worker lost N PDF(s)“ ab.

- Das passiert, sobald die Summe der Suchbereiche größer ist als `cacheMB`.
- Auch ein `invalidate()` durch den Indexer zwischen `place` und `scan` löst es aus. Bei [Z. 197](src/core/scan-pool.ts#L197) wird `resident.get(pk)!` dann zu einem TypeError.

**Vorschlag:** Suchen serialisieren oder Einträge per Referenzzähler festhalten.

### ~~M3 Ein Worker-Absturz lässt die Suche ewig hängen~~ — ✅ behoben in 0.3.5
`onerror` protokolliert den Fehler nur. Die offenen Promises in `pending` werden nie abgewiesen, die Anfrage an `/search` wartet ohne Ende.

### ~~M4 Pausieren und direkt danach „Jetzt indexieren“ tut nichts~~ — ✅ behoben in 0.3.5
`pause()` setzt `stopRequested`. Läuft der alte Durchlauf noch, gibt `run()` einfach das bestehende `runPromise` zurück, und der Durchlauf endet wie angefordert. Der neue Auftrag geht verloren.

### ~~M5 Tippfehler in `libraries` entfernt alle Bücher~~ — ✅ behoben in 0.3.5
[indexer.ts:153](src/core/indexer.ts#L153)

Ungültige oder unbekannte Bibliotheksschlüssel werden stillschweigend verworfen. Bleibt dabei die Liste leer, obwohl etwas eingetragen war, entfernt `scan()` ([Z. 169](src/core/indexer.ts#L169)) jedes Buch aus dem Index. Hier sollte eine Warnung kommen oder abgebrochen werden, statt zu löschen.

### ~~M6 Benachrichtigungen werden nach dem Shutdown noch verarbeitet~~ — ✅ behoben in 0.3.7
- `stopped` wird nur in `notify` geprüft, nicht in `flushNotifications` oder `forget`. Ein Timer, der noch läuft, greift nach `store.close()` auf die DB zu.
- Zwei Flushes können sich überlappen, weil `notifyTimer` im `finally` zurückgesetzt wird, bevor der Flush fertig ist.

### ~~M7 Ein Fehler in einer Lane stoppt die anderen nicht~~ — ✅ behoben in 0.3.5
[indexer.ts:462](src/core/indexer.ts#L462)

Wirft eine Lane, lehnt `Promise.all` zwar ab, die übrigen Lanes schicken aber weiter Batches an den Server und rufen `emit()` auf.

### ~~M8 Jeder `TypeError` wird als Serverproblem gewertet~~ — ✅ behoben in 0.3.5
[indexer.ts:392](src/core/indexer.ts#L392)

Ein Programmierfehler lässt das PDF dann für immer in der Queue und hält jeden Durchlauf an. Mit `autoIndex` wiederholt sich das bei jeder Benachrichtigung. Besser nur die Netzwerkfehler von `fetch` gezielt erkennen.

### ~~M9 `loop()` ruft sich ohne Fortschrittsprüfung selbst auf~~ — ✅ behoben in 0.3.5
[indexer.ts:336](src/core/indexer.ts#L336)

Bleibt ein Dokument dauerhaft `queued`, etwa weil `processBook` bei `!book` sofort zurückkehrt, rekursiert `loop()` ohne Ende. Das ist unwahrscheinlich, aber nicht abgesichert.

### ~~M10 Laufende Änderungen an Dateien gehen verloren~~ — ✅ behoben in 0.3.5
Ablauf:
1. Die Datei eines PDFs ändert sich, während es indiziert wird.
2. `syncBook` setzt das PDF auf `queued` mit neuem Hash.
3. `writeDocument` überschreibt danach mit `ready` und dem alten Hash.

Das korrigiert sich erst beim nächsten Sync. Mit `autoIndex=false` passiert das nicht automatisch.

---

## Niedrig

### Performance
- `scan()` berechnet bei jedem „Jetzt indexieren“ den MD5 jedes PDFs der gesamten Bibliothek. Besser vorher Größe und mtime vergleichen.
- `syncBook` ruft für jedes Item `libraryIDs()` auf, also jedes Mal `Libraries.getAll()`.
- `evict()` ruft in der Schleife jedes Mal `totalBytes()` auf. Das ist O(n²).
- `emit()` nach jedem Embedding-Batch löst jedes Mal eine volle Join-Abfrage in `column.reload()` und einen `trackCurrentBook`-Query aus. Das ist nur durch 200 ms Verzögerung gebremst.
- `/seekbook/books` macht N+1-Abfragen. `bookStatusText` holt die komplette Queue, nur um `booksAhead` zu berechnen.

### Textaufbereitung
- [outline.ts:80](src/core/text/outline.ts#L80): `next.top ? 0 : 1` behandelt `top === 0` (Überschrift ganz oben auf der Seite) wie „Position unbekannt“. Das Kapitel endet dann eine Seite früher. Das ist meist richtig, aber zufällig richtig: `top` wird hier als Wahrheitswert benutzt.
- [chapters.ts:53](src/core/text/chapters.ts#L53): Die Variante „erste 4 Wörter“ von `titleVariants` kann auf häufige Wortfolgen im Fließtext treffen. Das wird nur durch die Bewertung abgefedert, nicht verhindert.
- [chapters.ts:37](src/core/text/chapters.ts#L37): `normalizeWithMap` testet jedes Zeichen einzeln per Unicode-Regex, und das für jeden Kapitelknoten. Bei großen Gliederungen ist das spürbar, aber unkritisch.
- Bei `clean.ts` und `outline.ts` habe ich sonst nichts Auffälliges gefunden. Die Heuristiken sind nachvollziehbar dokumentiert.

### Sicherheit und Einstellungen
- Ein erlaubter Remote-Host darf auch über `http:` angesprochen werden. Dann gehen API-Key und Buchtext im Klartext über das Netz. Es gibt nur einen Hilfetext dazu, keine technische Warnung.
- `cacheMB`, `batchSize` und `embedConcurrency` lassen sich nur über about:config ändern. `cacheMB` wird außerdem nur beim Start übernommen (`setLimitMB` in `startup`).
- [client.ts:25](src/core/embed/client.ts#L25): Der Kommentar sagt „no truncation … is better“, der Code setzt aber `truncate: true`.

### Toter Code
- `hasFts5`, `bytesToInt8`, `dotInt8`, `itemByKey`, `newAbortController`, `newTextDecoder` und `TopK` in ranking.ts werden nirgends verwendet.
- Der i18n-Key `status.added` wird nirgends verwendet.
- Doppelter JSDoc-Block vor `LAYOUT_VERSION` in [indexer.ts:42-46](src/core/indexer.ts#L42-L46).

---

## Empfohlene Reihenfolge

1. ~~**H1, H2, H3 und H5.** Sie kosten Daten oder machen den Index inkonsistent. Ein gemeinsamer Fix ist möglich: ein Konfigurationswechsel pausiert nur noch, gelöscht wird nur über `rebuild()`, und `bootstrap.js` wartet `shutdown()` ab.~~ ✅ 0.3.4
2. ~~**H6.** Sicherheit.~~ ✅ 0.3.6
3. ~~**M1, M2 und M3.** Hänger und Abstürze.~~ ✅ 0.3.5 / 0.3.7
4. ~~**H4.** Kleiner Fix mit großer Wirkung für Nutzer mit synchronisierten Bibliotheken.~~ ✅ 0.3.4
5. Die übrigen Punkte nach Gelegenheit.
