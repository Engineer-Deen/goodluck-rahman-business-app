const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');

const PROTOCOL_SCHEME = 'goodluckrahman';

if (process.platform === 'win32' && app.setAppUserModelId) {
  app.setAppUserModelId('com.goodluck.rahman');
}

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.setPath('userData', path.join(app.getPath('appData'), 'goodluck-rahman-enterprise'));

const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  app.quit();
}

function handleProtocolUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return;
  if (!rawUrl.startsWith(`${PROTOCOL_SCHEME}:`)) return;
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

app.on('second-instance', (_event, argv) => {
  if (process.platform === 'win32') {
    const url = argv.find(arg => arg.startsWith(`${PROTOCOL_SCHEME}:`));
    if (url) handleProtocolUrl(url);
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

const store = new Store({ name: 'goodluck-data' });
const UPDATE_FEED_URL_KEY = 'glr_update_feed_url';
const DEFAULT_UPDATE_FEED_URL = 'https://goodluckrahmanenterprise.netlify.app/';
let mainWindow = null;
let autoUpdaterInitialized = false;
let staticHttpServer = null;

const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function createBrowserWindow() {
  return new BrowserWindow({
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
}

function staticRequestHandler(rootDir) {
  return (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      let pathname = u.pathname || '/';
      if (pathname === '/') pathname = '/index.html';
      const relative = pathname.replace(/^\/+/, '');
      const absolute = path.resolve(rootDir, relative);
      const rootResolved = path.resolve(rootDir);
      if (!absolute.startsWith(rootResolved + path.sep) && absolute !== rootResolved) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      fs.readFile(absolute, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(absolute).toLowerCase();
        res.writeHead(200, { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    } catch (_err) {
      res.writeHead(500);
      res.end();
    }
  };
}

function loadWindowFromFile(win) {
  win.loadFile(path.join(__dirname, 'index.html'));
  win.setMenuBarVisibility(false);
  setupDevHotReload(win);
  mainWindow = win;
  setupAutoUpdater();
  win.on('closed', () => {
    mainWindow = null;
  });
}

function createWindow() {
  const rootDir = __dirname;
  const server = http.createServer(staticRequestHandler(rootDir));

  const openWithFileFallback = () => {
    if (mainWindow && !mainWindow.isDestroyed()) return;
    const win = createBrowserWindow();
    loadWindowFromFile(win);
  };

  server.on('error', (err) => {
    console.error('Local static server failed; falling back to file://', err);
    openWithFileFallback();
  });

  server.listen(0, '127.0.0.1', () => {
    staticHttpServer = server;
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const win = createBrowserWindow();
    win.loadURL(`http://127.0.0.1:${port}/index.html`);
    win.setMenuBarVisibility(false);
    setupDevHotReload(win);
    mainWindow = win;
    setupAutoUpdater();
    win.on('closed', () => {
      mainWindow = null;
      if (staticHttpServer) {
        try {
          staticHttpServer.close();
        } catch (_e) {
          /* ignore */
        }
        staticHttpServer = null;
      }
    });
  });
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

  autoUpdater.on('update-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-available', info);
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:download-progress', progress);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('updater:update-downloaded', info);
    }
    try {
      autoUpdater.quitAndInstall();
    } catch (_err) {
      // Ignore install error in case the app cannot restart immediately.
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
  if (!app.isDefaultProtocolClient(PROTOCOL_SCHEME)) {
    app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
  }
  if (process.platform === 'win32') {
    const url = process.argv.find(arg => arg.startsWith(`${PROTOCOL_SCHEME}:`));
    if (url) handleProtocolUrl(url);
  }
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
