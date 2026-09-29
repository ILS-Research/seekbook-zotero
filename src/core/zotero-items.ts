/** Library keys ('user' | 'group:<id>', like ZotSeek) and item lookups. */

export function libraryKeyOf(libraryID: number): string | null {
  if (libraryID === Zotero.Libraries.userLibraryID) return 'user';
  const groupID = Zotero.Groups.getGroupIDFromLibraryID?.(libraryID);
  return groupID ? `group:${groupID}` : null;
}

export function libraryIDOf(libraryKey: string): number | null {
  if (libraryKey === 'user') return Zotero.Libraries.userLibraryID;
  const m = libraryKey.match(/^group:(\d+)$/);
  if (!m) return null;
  const id = Zotero.Groups.getLibraryIDFromGroupID(Number(m[1]));
  return id === false || id === undefined ? null : id;
}

export function itemByKey(libraryKey: string, itemKey: string): any | null {
  const libraryID = libraryIDOf(libraryKey);
  if (libraryID === null) return null;
  return Zotero.Items.getByLibraryAndKey(libraryID, itemKey) || null;
}

export function isValidLibraryKey(key: string): boolean {
  return key === 'user' || /^group:\d+$/.test(key);
}
