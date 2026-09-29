/** Varied German-looking prose for tests (running-header detection masks digits, so pages must differ in words). */
const WORDS = ('Stadt Klima Regen Hitze Planung Wasser Boden Fläche Park Baum Straße Dach Luft Wind Messung Modell Daten ' +
  'Methode Ergebnis Studie Quartier Verwaltung Beteiligung Finanzierung Versiegelung Abfluss Verdunstung Schatten ' +
  'Temperatur Nacht Sommer Winter Gebäude Fassade Grün Infrastruktur Kanal Speicher Mulde Rigole Strategie').split(' ');

let seed = 1;
function next(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
}

export function sentence(): string {
  const n = 6 + (next() % 6);
  const ws = Array.from({ length: n }, () => WORDS[next() % WORDS.length].toLowerCase());
  ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
  return ws.join(' ') + '.';
}

export function prose(sentences: number): string {
  return Array.from({ length: sentences }, sentence).join(' ');
}
