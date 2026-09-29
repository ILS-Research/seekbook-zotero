// Copy of parseSearchResponse from ../seekchat-zotero_src/src/core/zotseek/client.ts (M3 acceptance: SeekChat reads SeekBook results).
/* eslint-disable */
type ZotSeekPassage = any;
function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function asScore(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
export function parseSearchResponse(json: any): ZotSeekPassage[] {
  if (!json || !Array.isArray(json.results)) throw new Error('unexpected ZotSeek response: no "results" list');
  const out: ZotSeekPassage[] = [];
  for (const r of json.results) {
    if (!r || typeof r.itemKey !== 'string' || !r.itemKey) continue;
    const chunk = r.matchedChunk && typeof r.matchedChunk === 'object' ? r.matchedChunk : {};
    const authors = Array.isArray(r.authors) ? r.authors.filter((a: unknown) => typeof a === 'string')
      : typeof r.authors === 'string' && r.authors ? [r.authors] : [];
    out.push({
      itemKey: r.itemKey,
      libraryKey: typeof r.libraryKey === 'string' ? r.libraryKey : null,
      title: typeof r.title === 'string' ? r.title : '',
      authors,
      year: asNumber(r.year),
      score: asNumber(r.score) ?? 0,
      semanticScore: asScore(r.semanticScore),
      keywordScore: asScore(r.keywordScore),
      text: typeof chunk.snippet === 'string' && chunk.snippet.trim() ? chunk.snippet : undefined,
      page: asNumber(chunk.page),
      textSource: typeof chunk.textSource === 'string' ? chunk.textSource : undefined,
      noteKey: typeof chunk.noteKey === 'string' ? chunk.noteKey : undefined,
    });
  }
  return out;
}
