const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const Store = require('electron-store');
const { autoUpdater } = require('electron-updater');
const dotenv = require('dotenv');
const envPath = path.join(__dirname, '..', '.env.local');
const envResult = dotenv.config({ path: envPath });
if (envResult.error) {
  console.warn('Firebase config .env.local not loaded:', envPath, envResult.error.message || envResult.error);
} else {
  console.log('Firebase config loaded from .env.local');
}

const PROTOCOL_SCHEME = 'goodluckrahman';

if (process.platform === 'win32' && app.setAppUserModelId) {
  app.setAppUserModelId('com.goodluck.rahman');
}

const APP_USER_DATA_PATH = path.join(app.getPath('appData'), 'goodluck-rahman-enterprise');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-application-cache');
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('user-data-dir', APP_USER_DATA_PATH);
app.commandLine.appendSwitch('disk-cache-dir', path.join(APP_USER_DATA_PATH, 'Cache2'));
app.setPath('userData', APP_USER_DATA_PATH);

const gotInstanceLock = app.requestSingleInstanceLock();
if (!gotInstanceLock) {
  console.error('Another instance detected: quitting this instance');
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

app.on('before-quit', (e) => {
  console.log('app.before-quit');
});

app.on('will-quit', (e) => {
  console.log('app.will-quit');
});

const store = new Store({ name: 'goodluck-data' });
const UPDATE_FEED_URL_KEY = 'glr_update_feed_url';
const DEFAULT_UPDATE_FEED_URL = '';
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
      console.log('Local request for', pathname);
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
          console.error('Static file read failed', absolute, err);
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(absolute).toLowerCase();
        res.writeHead(200, { 'Content-Type': STATIC_MIME[ext] || 'application/octet-stream' });
        res.end(data);
      });
    } catch (err) {
      console.error('Static request handler error', err);
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
  console.log('createWindow(): starting local static server');
  const rootDir = __dirname;
  const server = http.createServer(staticRequestHandler(rootDir));

  // In development, load the file directly to avoid local HTTP server/network issues
  if (!app.isPackaged) {
    console.log('Dev mode detected: loading index.html directly from file');
    const win = createBrowserWindow();
    console.log('createWindow: created BrowserWindow id=', win && win.id);
    win.webContents.on('did-finish-load', () => {
      console.log('Window loaded successfully (file):', win.webContents.getURL());
    });
    // Forward renderer console messages to main process console for debugging
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      try{
        console.log(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
      }catch(e){/* ignore */}
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Window failed to load (file):', errorCode, errorDescription, validatedURL);
    });
    win.webContents.on('did-frame-finish-load', () => {
      console.log('WebContents did frame finish load');
    });
    win.webContents.on('crashed', () => {
      console.error('WebContents crashed');
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('Render process gone:', details.reason, details.exitCode);
    });
    win.on('ready-to-show', () => {
      console.log('Window ready to show');
      try{ win.show(); }catch(e){ console.error('Error showing window', e); }
    });
    try{
      win.loadFile(path.join(__dirname, 'index.html'));
    }catch(err){
      console.error('loadFile exception:', err);
    }
    win.setMenuBarVisibility(false);
    setupDevHotReload(win);
    mainWindow = win;
    try{
      // Open DevTools in detached mode to capture renderer errors during development
      win.webContents.openDevTools({ mode: 'detach' });
      console.log('DevTools opened for debugging');
    }catch(_e){ }
    console.log('createWindow: mainWindow assigned id=', mainWindow && mainWindow.id);
    setupAutoUpdater();
    win.on('closed', () => {
      console.log('Main window closed');
      mainWindow = null;
    });
    return;
  }

  const openWithFileFallback = () => {
    console.log('createWindow(): falling back to file:// loader');
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
    console.log(`Local static server listening on port ${port}`);
    const win = createBrowserWindow();
    console.log('createWindow: created BrowserWindow id=', win && win.id);
    win.webContents.on('did-finish-load', () => {
      console.log('Window loaded successfully:', win.webContents.getURL());
    });
    // Forward renderer console messages to main process console for debugging
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      try{
        console.log(`Renderer console [${level}] ${sourceId}:${line} ${message}`);
      }catch(e){/* ignore */}
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Window failed to load:', errorCode, errorDescription, validatedURL);
    });
    win.webContents.on('did-frame-finish-load', () => {
      console.log('WebContents did frame finish load');
    });
    win.webContents.on('crashed', () => {
      console.error('WebContents crashed');
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('Render process gone:', details.reason, details.exitCode);
    });
    win.on('ready-to-show', () => {
      console.log('Window ready to show');
      try{ win.show(); }catch(e){ console.error('Error showing window', e); }
    });
    // loadURL may throw or reject; capture any errors
    try{
      const loadResult = win.loadURL(`http://127.0.0.1:${port}/index.html`);
      if (loadResult && typeof loadResult.then === 'function') {
        loadResult.catch(err => console.error('loadURL rejected:', err));
      }
    }catch(err){
      console.error('loadURL exception:', err);
    }
    win.setMenuBarVisibility(false);
    setupDevHotReload(win);
    mainWindow = win;
    console.log('createWindow: mainWindow assigned id=', mainWindow && mainWindow.id);
    setupAutoUpdater();
    win.on('closed', () => {
      console.log('Main window closed');
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
  let feedUrl = typeof val === 'string' ? val.trim() : '';
  if (feedUrl === 'https://goodluckrahmanenterprise.netlify.app/') {
    // Migrate old Netlify default feed out of stored config so GitHub Releases can be used.
    store.delete(UPDATE_FEED_URL_KEY);
    feedUrl = '';
  }
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
  try {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.autoRunAppAfterInstall = true;
    if (feedUrl) {
      applyUpdateFeedUrl(feedUrl);
    }
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
    } catch (err) {
      console.error('Failed to restart and install update:', err);
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

ipcMain.handle('firebase:get-config', async () => ({
  apiKey: process.env.FIREBASE_API_KEY || '',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.FIREBASE_APP_ID || '',
  databaseURL: process.env.FIREBASE_DATABASE_URL || '',
}));

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
      autoUpdater.autoRunAppAfterInstall = true;
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
  try {
    if (feedUrl) {
      applyUpdateFeedUrl(feedUrl);
    }
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
  console.log('app.whenReady(): Electron is ready');
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
  console.log('app.window-all-closed: no more windows open');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in main process:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection in main process:', reason, promise);
});

// Receive forwarded logs from renderer
ipcMain.on('renderer:console', (_event, level, message) => {
  try{ console.log(`Renderer.${level}: ${message}`); }catch(_e){}
});
ipcMain.on('renderer:error', (_event, info) => {
  try{ console.error('Renderer.error event:', info); }catch(_e){}
});
ipcMain.on('renderer:unhandledrejection', (_event, info) => {
  try{ console.error('Renderer.unhandledrejection:', info); }catch(_e){}
});
