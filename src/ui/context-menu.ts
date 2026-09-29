/**
 * Item context menu for books (same pattern as SeekChat):
 *   "Zum Buchindex hinzufügen (SeekBook)" – books not yet in the index (works without automatic indexing)
 *   "Neu indexieren (SeekBook)"            – books in the index: all their PDFs again
 *   "Indexstatus des Buchs (SeekBook) …"   – one book: state of each PDF and the progress
 *
 * Zotero 8+ has Zotero.MenuManager (target "main/library/item"); Zotero 7 gets
 * the same entries added to #zotero-itemmenu directly.
 */
import { libraryKeyOf } from '../core/zotero-items';
import { logError } from '../util/log';

export const MENU_IDS = { add: 'seekbook-menu-add', reindex: 'seekbook-menu-reindex', info: 'seekbook-menu-info' };
const MENU_ID = 'seekbook-item-menu';

export interface MenuActions {
  /** Synchronous: is this book in the index? */
  isKnown(item: any): boolean;
  index(items: any[], force: boolean): Promise<void>;
  showStatus(item: any): Promise<void>;
}

let actions: MenuActions | null = null;
let menuRegistration: string | false = false;

function selectedItems(): any[] {
  return Zotero.getActiveZoteroPane?.()?.getSelectedItems?.() || [];
}

function books(items = selectedItems()): any[] {
  return items.filter((i) => i?.isRegularItem?.() && i.itemType === 'book' && libraryKeyOf(i.libraryID));
}

export function menuState(items = selectedItems()): { add: boolean; reindex: boolean; info: boolean } {
  const b = books(items);
  const known = actions ? b.filter((i) => actions!.isKnown(i)).length : 0;
  return { add: b.length > known, reindex: known > 0, info: b.length === 1 };
}

function run(fn: () => Promise<void>): void {
  fn().catch(logError);
}

export function onAdd(items = selectedItems()): Promise<void> {
  return actions ? actions.index(books(items).filter((i) => !actions!.isKnown(i)), false) : Promise.resolve();
}

export function onReindex(items = selectedItems()): Promise<void> {
  return actions ? actions.index(books(items).filter((i) => actions!.isKnown(i)), true) : Promise.resolve();
}

export function onInfo(items = selectedItems()): Promise<void> {
  const [book] = books(items);
  return actions && book ? actions.showStatus(book) : Promise.resolve();
}

/** Zotero 8+: MenuManager. Returns false if the API is missing (Zotero 7). */
export function registerMenus(pluginID: string, icon: string, a: MenuActions): boolean {
  actions = a;
  const mm = (Zotero as any).MenuManager;
  if (!mm) return false;
  const item = (key: keyof typeof MENU_IDS, onCommand: () => void) => ({
    menuType: 'menuitem',
    l10nID: MENU_IDS[key],
    icon,
    onShowing: (_e: any, ctx: any) => ctx.setVisible(menuState()[key]),
    onCommand,
  });
  try {
    menuRegistration = mm.registerMenu({
      menuID: MENU_ID,
      pluginID,
      target: 'main/library/item',
      menus: [
        { menuType: 'separator', onShowing: (_e: any, ctx: any) => ctx.setVisible(menuState().info || menuState().add || menuState().reindex) },
        item('add', () => run(() => onAdd())),
        item('reindex', () => run(() => onReindex())),
        item('info', () => run(() => onInfo())),
      ],
    }) || false;
  } catch (e) {
    logError(e);
    menuRegistration = false;
  }
  return menuRegistration !== false;
}

export function unregisterMenus(): void {
  if (menuRegistration) (Zotero as any).MenuManager?.unregisterMenu(menuRegistration);
  menuRegistration = false;
  actions = null;
}

/** Zotero 7: the same entries, added to the item context menu of a main window. */
export function addLegacyMenu(win: any): void {
  if (menuRegistration) return;
  const doc = win.document;
  const popup = doc.getElementById('zotero-itemmenu');
  if (!popup || doc.getElementById(MENU_IDS.add)) return;
  const sep = doc.createXULElement('menuseparator');
  sep.id = `${MENU_ID}-separator`;
  const make = (id: string, onCommand: () => void) => {
    const m = doc.createXULElement('menuitem');
    m.id = id;
    m.setAttribute('data-l10n-id', id);
    m.addEventListener('command', onCommand);
    return m;
  };
  const entries = {
    add: make(MENU_IDS.add, () => run(() => onAdd())),
    reindex: make(MENU_IDS.reindex, () => run(() => onReindex())),
    info: make(MENU_IDS.info, () => run(() => onInfo())),
  };
  popup.append(sep, entries.add, entries.reindex, entries.info);
  popup.addEventListener('popupshowing', (e: any) => {
    if (e.target !== popup) return;
    const s = menuState();
    for (const key of Object.keys(entries) as (keyof typeof entries)[]) entries[key].hidden = !s[key];
    sep.hidden = !s.add && !s.reindex && !s.info;
  });
}

export function removeLegacyMenu(win: any): void {
  for (const id of [`${MENU_ID}-separator`, ...Object.values(MENU_IDS)]) win.document.getElementById(id)?.remove();
}
