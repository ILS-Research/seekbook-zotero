/* SeekBook bootstrap: registers chrome, loads the bundle, delegates to Zotero.SeekBook. */
var chromeHandle;

function install() {}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;

  const aomStartup = Components.classes["@mozilla.org/addons/addon-manager-startup;1"]
    .getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "seekbook", rootURI + "content/"],
    ["locale", "seekbook", "en-US", rootURI + "locale/en-US/"],
    ["locale", "seekbook", "de", rootURI + "locale/de/"],
  ]);

  const ctx = { rootURI, Zotero };
  ctx._globalThis = ctx;
  try {
    Services.scriptloader.loadSubScript(rootURI + "content/scripts/seekbook.js", ctx);
    await Zotero.SeekBook.startup({ id, version, rootURI });
  } catch (e) {
    Zotero.debug("[SeekBook] startup failed: " + e);
    Zotero.logError(e);
  }
}

function onMainWindowLoad({ window }) {
  Zotero.SeekBook?.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  Zotero.SeekBook?.onMainWindowUnload(window);
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) {
    // Only close our database connection; Zotero is going away anyway.
    Zotero.SeekBook?.store?.close();
    return;
  }
  Zotero.SeekBook?.shutdown();
  delete Zotero.SeekBook;
  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

function uninstall() {}
