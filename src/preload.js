const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

/**
 * Turn a path relative to this folder (e.g. src/) into a file:// URL.
 * Packaged apps load from app.asar; relative img src can fail — absolute URLs are reliable.
 */
function resolveAssetUrl(rel) {
  if (!rel || typeof rel !== 'string') return null;
  const normalized = rel.replace(/\\/g, '/');
  if (normalized.includes('..')) return null;
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized)) return null;
  if (!normalized.startsWith('assets/')) return null;
  const abs = path.normalize(path.join(__dirname, normalized));
  const relToSrc = path.relative(__dirname, abs);
  if (relToSrc.startsWith('..') || path.isAbsolute(relToSrc)) return null;
  try {
    if (!fs.existsSync(abs)) return null;
  } catch (_e) {
    return null;
  }
  return pathToFileURL(abs).href;
}

// Forward console and error events from renderer to main process for debugging
try{
  ['log','info','warn','error'].forEach(level => {
    const orig = console[level] && console[level].bind(console);
    console[level] = function(...args){
      try{
        const text = args.map(a => {
          try{ return typeof a === 'string' ? a : JSON.stringify(a); }catch(e){ return String(a); }
        }).join(' ');
        ipcRenderer.send('renderer:console', level, text);
      }catch(_e){}
      if(orig) orig(...args);
    };
  });

  window.addEventListener('error', (e) => {
    try{
      ipcRenderer.send('renderer:error', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno });
    }catch(_e){}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try{ ipcRenderer.send('renderer:unhandledrejection', { reason: String(e.reason) }); }catch(_e){}
  });
}catch(_e){/* non-fatal */}

contextBridge.exposeInMainWorld('electronAPI', {
  storeGetSync: (key) => ipcRenderer.sendSync('store-get-sync', key),
  storeSetSync: (key, value) => ipcRenderer.sendSync('store-set-sync', key, value),
  storeDeleteSync: (key) => ipcRenderer.sendSync('store-delete-sync', key),
  resolveAssetUrl: (rel) => resolveAssetUrl(rel),
  isPackagedApp: () => ipcRenderer.invoke('app:is-packaged'),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getUpdateConfig: () => ipcRenderer.invoke('updater:get-config'),
  setUpdateFeedUrl: (url) => ipcRenderer.invoke('updater:set-config', url),
  checkForAppUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('updater:download'),
  onUpdateAvailable: (callback) => ipcRenderer.on('updater:update-available', (_event, info) => callback(info)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('updater:download-progress', (_event, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('updater:download-downloaded', (_event, info) => callback(info)),
  getFirebaseConfig: () => ipcRenderer.invoke('firebase:get-config'),
});
