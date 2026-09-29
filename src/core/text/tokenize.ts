/**
 * Tokenizer and matching keys for the keyword (BM25) search. Copied from
 * SeekChat (src/core/context/page-selection.ts), so both plugins match words
 * the same way: umlauts folded, a common German/English ending dropped.
 */

const STOPWORDS = new Set((
  'der die das den dem des ein eine einer eines einem einen und oder aber nicht ist sind war waren wird werden ' +
  'wie was wer wo wann warum welche welcher welches mit von zu zum zur auf aus bei für über unter nach vor ' +
  'im in an am es sie er ich wir ihr sich auch noch nur schon sehr mehr kann können soll sollen hat haben ' +
  'dieser diese dieses dem gibt text dokument paper artikel seite seiten ' +
  'the a an and or but not is are was were be been what which who where when why how with from to of on ' +
  'in at by for about into this that these those it its they them there their can could should would does ' +
  'do did has have had paper document article page pages'
).split(' '));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []).filter((t) => !STOPWORDS.has(t));
}

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };
const SUFFIXES = ['ern', 'en', 'er', 'es', 'e', 'n', 's'];

/**
 * Matching key of a token: umlauts spelled out (Wärme = Waerme) and a common
 * German/English ending dropped (Wärmeinseln = Wärmeinsel, climates = climate).
 */
export function searchKey(token: string): string {
  const folded = token.replace(/[äöüß]/g, (c) => UMLAUTS[c]);
  const suffix = SUFFIXES.find((s) => folded.endsWith(s) && folded.length - s.length >= 4);
  return suffix ? folded.slice(0, -suffix.length) : folded;
}

/** Matching keys of a text, in order (duplicates kept for term frequencies). */
export function termKeys(text: string): string[] {
  return tokenize(text).map(searchKey);
}
