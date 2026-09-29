// Writes the E2E fixture PDFs into the given directory. No dependencies.
//   seekbook-whole.pdf  12 pages: title, table of contents, chapter 1 (p. 3-7), chapter 2 (p. 8-12);
//                       running header "Handbuch Stadtklima <printed page>" on pages 3-12, bookmarks,
//                       page labels i, ii, 1, 2, ...
//   seekbook-ch1.pdf    the pages of chapter 1 alone (same text, own header numbers)
//   seekbook-ch2.pdf    the pages of chapter 2 alone
//   seekbook-other.pdf  a different book (volcanoes), 4 pages, no bookmarks
//   seekbook-other2.pdf changed version of it (for "changed file => reindex")
import fs from 'node:fs';
import path from 'node:path';

/** pages: array of line arrays; outline: [{ title, page (0-based), children }]; labels: PDF /PageLabels /Nums array text. */
function writePdf(file, pages, outline = null, labels = null) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (const lines of pages) {
    const ops = ['BT', '/F1 10 Tf', '13 TL', '50 790 Td', ...lines.map((l) => `(${esc(l)}) Tj T*`), 'ET'].join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(ops)} >>\nstream\n${ops}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  let extra = '';
  if (outline?.length) {
    const root = add(null);
    const writeLevel = (entries, parent) => {
      const ids = entries.map(() => add(null));
      entries.forEach((e, i) => {
        const sub = e.children?.length ? writeLevel(e.children, ids[i]) : null;
        objects[ids[i] - 1] = `<< /Title (${esc(e.title)}) /Parent ${parent} 0 R` +
          (i > 0 ? ` /Prev ${ids[i - 1]} 0 R` : '') + (i < ids.length - 1 ? ` /Next ${ids[i + 1]} 0 R` : '') +
          (sub ? ` /First ${sub[0]} 0 R /Last ${sub[sub.length - 1]} 0 R /Count ${sub.length}` : '') +
          ` /Dest [${kids[e.page]} 0 R ${e.y === undefined ? '/Fit' : `/XYZ 0 ${e.y} null`}] >>`;
      });
      return ids;
    };
    const top = writeLevel(outline, root);
    objects[root - 1] = `<< /Type /Outlines /First ${top[0]} 0 R /Last ${top[top.length - 1]} 0 R /Count ${top.length} >>`;
    extra += ` /Outlines ${root} 0 R`;
  }
  if (labels) extra += ` /PageLabels << /Nums [${labels}] >>`;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R${extra} >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(file, out, 'latin1');
}

// Deterministic, varied prose (running-header detection masks digits, so pages must differ in words).
const WORDS = ('Stadt Klima Regen Planung Wasser Boden Flaeche Park Baum Strasse Dach Luft Wind Messung Modell Daten ' +
  'Methode Ergebnis Studie Quartier Verwaltung Beteiligung Finanzierung Versiegelung Abfluss Verdunstung Schatten ' +
  'Temperatur Nacht Sommer Winter Gebaeude Fassade Gruen Infrastruktur Kanal Speicher Mulde Rigole Strategie').split(' ');
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
function sentence(topic) {
  const ws = Array.from({ length: 7 + (rnd() % 6) }, () => WORDS[rnd() % WORDS.length].toLowerCase());
  if (topic && rnd() % 3 === 0) ws.splice(2, 0, topic);
  ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
  return ws.join(' ') + '.';
}
/** About 36 lines of ~85 characters. */
function pageLines(topic, first = []) {
  const lines = [...first];
  let line = '';
  while (lines.length < 36) {
    const s = sentence(topic);
    if ((line + ' ' + s).length > 85) { lines.push(line.trim()); line = s; } else line += ' ' + s;
  }
  return lines;
}

const dir = process.argv[2];
fs.mkdirSync(dir, { recursive: true });

const header = (printed) => `Handbuch Stadtklima ${printed}`;
const ch1 = Array.from({ length: 5 }, (_, i) => pageLines('Starkregen', i === 0 ? ['Kapitel 1 Starkregen und Abfluss'] : []));
const ch2 = Array.from({ length: 5 }, (_, i) => pageLines('Waermeinseln', i === 0 ? ['Kapitel 2 Waermeinseln im Quartier'] : []));
ch2[3][5] = 'Die Stichprobe umfasst 48 Messstationen in dicht bebauten Quartieren der Innenstadt.';
// Section 2.2 starts in the middle of chapter 2's third page (physical page 10), bookmark with y position.
ch2[2][18] = '2.2 Stadtbaeume und Schatten';
ch2[2][19] = 'Stadtbaeume spenden Schatten und kuehlen die Luft in engen Strassen deutlich.';
const SECTION_Y = 790 - 13 * 19 + 10; // line 19 of the page (header is line 0), a little above the text

const title = ['Handbuch Stadtklima', 'Ein Testbuch fuer SeekBook'];
const toc = ['Inhaltsverzeichnis', 'Kapitel 1 Starkregen und Abfluss ........ 1', '1.1 Grundlagen ........ 2',
  'Kapitel 2 Waermeinseln im Quartier ........ 6', '2.1 Messungen ........ 8', 'Register ........ 11'];
const body = [...ch1, ...ch2].map((lines, i) => [header(i + 1), ...lines]);
writePdf(path.join(dir, 'seekbook-whole.pdf'), [title, toc, ...body], [
  { title: 'Titel', page: 0 },
  { title: 'Kapitel 1 Starkregen', page: 2, children: [{ title: 'Grundlagen', page: 3 }] },
  { title: 'Kapitel 2 Waermeinseln', page: 7, children: [{ title: 'Messungen', page: 9, y: 790 }, { title: '2.2 Stadtbaeume und Schatten', page: 9, y: SECTION_Y }] },
], '0 << /S /r >> 2 << /S /D /St 1 >>');
writePdf(path.join(dir, 'seekbook-ch1.pdf'), ch1.map((lines, i) => [header(i + 1), ...lines]));
writePdf(path.join(dir, 'seekbook-ch2.pdf'), ch2.map((lines, i) => [header(i + 6), ...lines]));

seed = 99;
const other = Array.from({ length: 4 }, (_, i) => pageLines('Vulkane', i === 0 ? ['Vulkane und Klima'] : []));
writePdf(path.join(dir, 'seekbook-other.pdf'), other);
const other2 = other.map((lines) => [...lines]);
other2[2][4] = 'Der Ausbruch des Pinatubo senkte die globale Temperatur um ein halbes Grad Celsius.';
writePdf(path.join(dir, 'seekbook-other2.pdf'), other2);
