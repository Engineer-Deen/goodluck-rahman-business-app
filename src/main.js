const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setPath('userData', path.join(app.getPath('appData'), 'goodluck-rahman-enterprise'));

const store = new Store({ name: 'goodluck-data' });
const UPDATE_FEED_URL_KEY = 'glr_update_feed_url';
const DEFAULT_UPDATE_FEED_URL = 'https://goodluckrahmanenterprise.netlify.app/';
let mainWindow = null;
let autoUpdaterInitialized = false;

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));
  win.setMenuBarVisibility(false);

  setupDevHotReload(win);
  mainWindow = win;
  setupAutoUpdater();
}

function setupDevHotReload(win) {
  if (app.isPackaged) return;
  const srcDir = path.join(__dirname);
  let reloadTimer = null;
  let watcher = null;
  try {
    watcher = fs.watch(srcDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const name = String(filename).toLowerCase();
      if (!name.endsWith('.js') && !name.endsWith('.html') && !name.endsWith('.css')) return;
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => {
        if (!win.isDestroyed()) win.webContents.reloadIgnoringCache();
      }, 250);
    });
    win.on('closed', () => {
      if (watcher) watcher.close();
      if (reloadTimer) clearTimeout(reloadTimer);
    });
  } catch (_err) {
    // Do not break app startup if file watching is unavailable.
  }
}

function getUpdateFeedUrl() {
  const val = store.get(UPDATE_FEED_URL_KEY);
  const feedUrl = typeof val === 'string' ? val.trim() : '';
  return feedUrl || DEFAULT_UPDATE_FEED_URL;
}

function applyUpdateFeedUrl(url) {
  if (!url) return false;
  autoUpdater.setFeedURL({
    provider: 'generic',
    url,
  });
  return true;
}

function setupAutoUpdater() {
  if (!app.isPackaged || autoUpdaterInitialized) return;
  autoUpdaterInitialized = true;
  const feedUrl = getUpdateFeedUrl();
  if (!feedUrl) return;
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    applyUpdateFeedUrl(feedUrl);
  } catch (_err) {
    // Skip updater setup if config is invalid.
  }

  autoUpdater.on('update-downloaded', async (info) => {
    const title = 'Update ready';
    const detail = `Version ${info?.version || 'new'} has been downloaded. Install now?`;
    const result = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Install now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title,
      message: title,
      detail,
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
}

ipcMain.on('store-get-sync', (event, key) => {
  event.returnValue = store.get(key);
});

ipcMain.on('store-set-sync', (event, key, value) => {
  store.set(key, value);
  event.returnValue = true;
});

ipcMain.on('store-delete-sync', (event, key) => {
  store.delete(key);
  event.returnValue = true;
});

ipcMain.handle('app:is-packaged', async () => app.isPackaged);
ipcMain.handle('app:get-version', async () => app.getVersion());

ipcMain.handle('updater:get-config', async () => ({
  feedUrl: getUpdateFeedUrl(),
}));

ipcMain.handle('updater:set-config', async (_event, url) => {
  const value = String(url || '').trim();
  if (!/^https?:\/\//i.test(value)) {
    return { ok: false, message: 'Update URL must start with http:// or https://.' };
  }
  store.set(UPDATE_FEED_URL_KEY, value);
  if (app.isPackaged) {
    try {
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      applyUpdateFeedUrl(value);
    } catch (err) {
      return { ok: false, message: String(err && err.message ? err.message : err) };
    }
  }
  return { ok: true };
});

ipcMain.handle('updater:download', async () => {
  if (!app.isPackaged) {
    return { ok: false, message: 'Updates only run in packaged app.' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: String(err && err.message ? err.message : err) };
  }
});

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, message: 'Updates only run in packaged app.' };
  }
  const feedUrl = getUpdateFeedUrl();
  if (!feedUrl) {
    return { ok: false, message: 'Update URL is not configured.' };
  }
  try {
    applyUpdateFeedUrl(feedUrl);
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      return { ok: true, message: 'No update information available right now.' };
    }
    if (result.updateInfo.version === app.getVersion()) {
      return { ok: true, updateAvailable: false, message: 'Your app is up to date.' };
    }
    return {
      ok: true,
      updateAvailable: true,
      message: `Update available: version ${result.updateInfo.version}.`,
      version: result.updateInfo.version,
    };
  } catch (err) {
    return { ok: false, message: String(err && err.message ? err.message : err) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
