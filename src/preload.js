const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');

// LocalStore and other modules with native dependencies are loaded lazily to avoid issues
let LocalStoreModule = null;
let localStore = null;
let authRecovery = null;
let syncEngine = null;

// Initialize localStore with error handling for native modules
const initializeLocalStore = () => {
  try {
    if (LocalStoreModule) return localStore; // Already initialized
    LocalStoreModule = require('./local-store-sqlite');
    const userDataPath = ipcRenderer.sendSync('app:get-path-sync', 'userData');
    localStore = LocalStoreModule.init({ dir: path.join(userDataPath || __dirname, 'glr-data') });
    return localStore;
  } catch (err) {
    console.error('Failed to initialize local store:', err.message);
    localStore = null;
    return null;
  }
};

// Initialize auth recovery module
const initializeAuthRecovery = () => {
  try {
    if (authRecovery) return authRecovery;
    authRecovery = require('./auth-recovery');
    return authRecovery;
  } catch (err) {
    console.error('Failed to initialize auth recovery:', err.message);
    return null;
  }
};

// Initialize sync engine module  
const initializeSyncEngine = () => {
  try {
    if (syncEngine) return syncEngine;
    syncEngine = require('./sync-engine');
    return syncEngine;
  } catch (err) {
    console.error('Failed to initialize sync engine:', err.message);
    return null;
  }
};

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
  getFirebaseConfig: () => ipcRenderer.invoke('firebase:get-config'),
  localStoreAvailable: () => { initializeLocalStore(); return !!localStore; },
  localStoreGet: (key) => { const store = initializeLocalStore(); return store ? store.get(key) : null; },
  localStoreSet: (key, value) => { const store = initializeLocalStore(); return store ? store.set(key, value) : null; },
  localStoreDelete: (key) => { const store = initializeLocalStore(); return store ? store.delete(key) : null; },
  localStoreGetScoped: (key, account) => { const store = initializeLocalStore(); return store ? store.getScoped(key, account) : null; },
  localStoreSetScoped: (key, value, account) => { const store = initializeLocalStore(); return store ? store.setScoped(key, value, account) : null; },
  localStoreDeleteScoped: (key, account) => { const store = initializeLocalStore(); return store ? store.deleteScoped(key, account) : null; },
  localStoreGetRecords: (resource, account) => { const store = initializeLocalStore(); return store ? store.getRecords(resource, account) : []; },
  localStoreUpsertRecord: (resource, record, account) => { const store = initializeLocalStore(); return store ? store.upsertRecord(resource, record, account) : null; },
  localStoreDeleteRecord: (resource, id, account) => { const store = initializeLocalStore(); return store ? store.deleteRecord(resource, id, account) : null; },
  localStoreGetSyncQueue: (account) => { const store = initializeLocalStore(); return store ? store.getSyncQueue(account) : []; },
  localStoreClearSyncQueue: (account) => { const store = initializeLocalStore(); return store ? store.clearSyncQueue(account) : null; },
  localStoreSetSyncQueue: (queue, account) => { const store = initializeLocalStore(); return store ? store.setSyncQueue(queue, account) : null; },
  localStoreEnqueueSync: (op, payload, account) => { const store = initializeLocalStore(); return store ? store.enqueueSync(op, payload, account) : null; },
  localStoreRemoveQueueItem: (qid) => { const store = initializeLocalStore(); return store ? store.removeQueueItem(qid) : null; },
  localStoreIncrementQueueAttempt: (qid) => { const store = initializeLocalStore(); return store ? store.incrementQueueAttempt(qid) : null; },
  localStoreSetRecords: (resource, records, account, options) => { const store = initializeLocalStore(); return store ? store.setRecords(resource, records, account, options) : null; },
  localStoreAppendLog: (level, uid, code, message, meta) => { const store = initializeLocalStore(); return store ? store.appendLog(level, uid, code, message, meta) : null; },
  createAuthRecovery: (opts) => { const auth = initializeAuthRecovery(); return auth ? auth(opts) : null; },
  createSyncEngine: (opts) => { const sync = initializeSyncEngine(); return sync ? sync(opts) : null; },
  setUpdateFeedUrl: (url) => ipcRenderer.invoke('updater:set-config', url),
  checkForAppUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('updater:download'),
  onUpdateAvailable: (callback) => ipcRenderer.on('updater:update-available', (_event, info) => callback(info)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('updater:download-progress', (_event, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('updater:download-downloaded', (_event, info) => callback(info)),
});
