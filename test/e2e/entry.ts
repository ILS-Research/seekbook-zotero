/**
 * Entry point of the E2E build: the normal plugin plus the harness. When the
 * pref seekbook.e2e.resultsPath is set (only in the E2E profile), the harness
 * runs all scenarios after the first startup, writes the results and quits Zotero.
 */
import '../../src/index';
import { runAll } from './harness';

const plugin = Zotero.SeekBook;
const startup = plugin.startup.bind(plugin);
let started = false;
plugin.startup = async (info: any) => {
  await startup(info);
  // Scenarios restart the plugin; the harness runs once.
  if (started) return;
  started = true;
  const results = Zotero.Prefs.get('seekbook.e2e.resultsPath');
  Zotero.debug(`[SeekBook E2E] harness installed, resultsPath=${results}`);
  if (results) void runAll();
};
