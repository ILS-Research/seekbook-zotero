export function log(msg: string): void {
  Zotero.debug(`[SeekBook] ${msg}`);
}

export function logError(e: unknown): void {
  Zotero.debug(`[SeekBook] ERROR ${e}`);
  Zotero.logError(e);
}
