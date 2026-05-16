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
  onUpdateDownloaded: (callback) => ipcRenderer.on('updater:update-downloaded', (_event, info) => callback(info)),
});
