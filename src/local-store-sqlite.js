const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let db = null;
let dbPath = null;
let Database = null;

function ensureDatabase() {
  if (!Database) {
    try {
      Database = require('better-sqlite3');
    } catch (err) {
      console.error('better-sqlite3 load failed:', err.message);
      throw err;
    }
  }
}

function init(options = {}) {
  if (db) return db;
  ensureDatabase();
  const dir = options.dir || path.join(process.cwd(), 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  dbPath = options.file || path.join(dir, 'glr.sqlite');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  ensureSchema();
  return db;
}

function ensureSchema() {
  const s = db.prepare.bind(db);
  s(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`).run();
  s(`CREATE TABLE IF NOT EXISTS sales (
    id TEXT,
    account TEXT DEFAULT '',
    payload TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    lastSyncedAt TEXT,
    syncStatus TEXT,
    PRIMARY KEY(id,account)
  )`).run();
  s(`CREATE TABLE IF NOT EXISTS inventory (
    id TEXT,
    account TEXT DEFAULT '',
    payload TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    lastSyncedAt TEXT,
    syncStatus TEXT,
    version INTEGER DEFAULT 1,
    deletedAt TEXT,
    PRIMARY KEY(id,account)
  )`).run();
  s(`CREATE TABLE IF NOT EXISTS audit (
    id TEXT,
    account TEXT DEFAULT '',
    payload TEXT,
    createdAt TEXT,
    updatedAt TEXT,
    lastSyncedAt TEXT,
    syncStatus TEXT,
    version INTEGER DEFAULT 1,
    deletedAt TEXT,
    PRIMARY KEY(id,account)
  )`).run();
  s(`CREATE TABLE IF NOT EXISTS sync_queue (
    qid INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT DEFAULT '',
    recordId TEXT,
    op TEXT,
    resource TEXT,
    payload TEXT,
    createdAt TEXT,
    attemptCount INTEGER DEFAULT 0,
    lastAttemptAt TEXT
  )`).run();
  s(`CREATE TABLE IF NOT EXISTS upload_queue (
    qid INTEGER PRIMARY KEY AUTOINCREMENT,
    account TEXT DEFAULT '',
    taskId TEXT,
    recordId TEXT,
    resource TEXT,
    field TEXT,
    localUri TEXT,
    remoteUri TEXT,
    state TEXT,
    error TEXT,
    attemptCount INTEGER DEFAULT 0,
    createdAt TEXT,
    updatedAt TEXT
  )`).run();
  s(`CREATE TABLE IF NOT EXISTS sync_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT,
    level TEXT,
    uid TEXT,
    code TEXT,
    message TEXT,
    meta TEXT
  )`).run();
  s(`CREATE TABLE IF NOT EXISTS sync_state (k TEXT PRIMARY KEY, v TEXT)`).run();
  ensureTableColumns();
}

function ensureTableColumns() {
  const tables=[
    { name:'sales', columns:['version INTEGER DEFAULT 1','deletedAt TEXT'] },
    { name:'inventory', columns:['version INTEGER DEFAULT 1','deletedAt TEXT'] },
    { name:'audit', columns:['version INTEGER DEFAULT 1','deletedAt TEXT'] },
  ];
  for(const table of tables){
    const existing = db.prepare(`PRAGMA table_info(${table.name})`).all().map(r=>r.name);
    for(const columnDef of table.columns){
      const columnName = columnDef.split(' ')[0];
      if(!existing.includes(columnName)){
        db.prepare(`ALTER TABLE ${table.name} ADD COLUMN ${columnDef}`).run();
      }
    }
  }
}

function serialize(value) {
  return value === undefined ? null : JSON.stringify(value);
}

function deserialize(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    return value;
  }
}

function get(key) {
  if (!db) init();
  const row = db.prepare('SELECT v FROM meta WHERE k = ?').get(key);
  return row ? deserialize(row.v) : null;
}

function set(key, value) {
  if (!db) init();
  const json = serialize(value);
  db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(key, json);
}

function del(key) {
  if (!db) init();
  db.prepare('DELETE FROM meta WHERE k = ?').run(key);
}

function getScoped(key, account) {
  const scopedKey = account ? `${key}::${account}` : key;
  return get(scopedKey) || [];
}

function setScoped(key, value, account) {
  const scopedKey = account ? `${key}::${account}` : key;
  set(scopedKey, value);
}

function deleteScoped(key, account) {
  const scopedKey = account ? `${key}::${account}` : key;
  del(scopedKey);
}

function getResourceTable(resource) {
  if (resource === 'sales') return 'sales';
  if (resource === 'inventory') return 'inventory';
  if (resource === 'audit') return 'audit';
  return null;
}

function rowsToRecords(rows) {
  return (rows || []).map((row) => ({
    ...(deserialize(row.payload) || {}),
    id: row.id,
    account: row.account || '',
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSyncedAt: row.lastSyncedAt,
    syncStatus: row.syncStatus,
  }));
}

function getRecords(resource, account) {
  if (!db) init();
  const table = getResourceTable(resource);
  if (!table) return [];
  const normalizedAccount = account || '';
  const rows = db.prepare(`SELECT * FROM ${table} WHERE account = ? ORDER BY createdAt ASC`).all(normalizedAccount);
  return rowsToRecords(rows);
}

function writeRecord(resource, record, account, options = {}) {
  if (!db) init();
  const table = getResourceTable(resource);
  if (!table) return null;
  const normalizedAccount = account || '';
  const id = record.id || uuidv4();
  const now = new Date().toISOString();
  const createdAt = record.createdAt || now;
  const updatedAt = record.updatedAt || now;
  const lastSyncedAt = options.lastSyncedAt !== undefined ? options.lastSyncedAt : null;
  const hasSyncedFlag = record.synced === true || record.syncStatus === 'synced' || options.forceSynced;
  const syncStatus = record.syncStatus || (hasSyncedFlag ? 'synced' : 'pending');
  const payload = serialize({ ...record, synced: syncStatus === 'synced' });

  db.prepare(`INSERT INTO ${table} (id,account,payload,createdAt,updatedAt,lastSyncedAt,syncStatus) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id,account) DO UPDATE SET payload=excluded.payload, updatedAt=excluded.updatedAt, syncStatus=excluded.syncStatus, lastSyncedAt=COALESCE(excluded.lastSyncedAt, ${table}.lastSyncedAt)`).run(
    id,
    normalizedAccount,
    payload,
    createdAt,
    updatedAt,
    lastSyncedAt,
    syncStatus,
  );

  if (options.skipQueue) {
    return id;
  }

  const queuePayload = serialize({ id, resource, op: 'upsert', record });
  db.prepare('INSERT INTO sync_queue (account,recordId,op,resource,payload,createdAt) VALUES(?,?,?,?,?,?)').run(
    normalizedAccount,
    id,
    'upsert',
    resource,
    queuePayload,
    new Date().toISOString(),
  );

  return id;
}

function upsertRecord(resource, record, account, options = {}) {
  return writeRecord(resource, record, account, options);
}

function setRecords(resource, records, account, options = {}) {
  if (!db) init();
  const table = getResourceTable(resource);
  if (!table || !Array.isArray(records)) return [];
  const normalizedAccount = account || '';
  const ids = records.map((record) => record.id).filter(Boolean);
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM ${table} WHERE account = ? AND id NOT IN (${placeholders})`).run(normalizedAccount, ...ids);
  } else {
    db.prepare(`DELETE FROM ${table} WHERE account = ?`).run(normalizedAccount);
  }

  const saved = [];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const id = writeRecord(resource, record, normalizedAccount, { skipQueue: options.skipQueue, lastSyncedAt: options.lastSyncedAt });
    if (id) saved.push(id);
  }
  return saved;
}

function deleteRecord(resource, id, account) {
  if (!db) init();
  const table = getResourceTable(resource);
  if (!table) return false;
  const normalizedAccount = account || '';
  db.prepare(`DELETE FROM ${table} WHERE id = ? AND account = ?`).run(id, normalizedAccount);
  db.prepare('INSERT INTO sync_queue (account,recordId,op,resource,payload,createdAt) VALUES(?,?,?,?,?,?)').run(
    normalizedAccount,
    id,
    'delete',
    resource,
    serialize({ id }),
    new Date().toISOString(),
  );
  return true;
}

function getSyncQueue(account) {
  if (!db) init();
  const normalizedAccount = account || '';
  const rows = db.prepare('SELECT * FROM sync_queue WHERE account = ? ORDER BY qid ASC').all(normalizedAccount);
  return rows.map((row) => ({
    qid: row.qid,
    account: row.account,
    recordId: row.recordId,
    op: row.op,
    resource: row.resource,
    payload: deserialize(row.payload),
    createdAt: row.createdAt,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
  }));
}

function clearSyncQueue(account) {
  if (!db) init();
  const normalizedAccount = account || '';
  db.prepare('DELETE FROM sync_queue WHERE account = ?').run(normalizedAccount);
}

function setSyncQueue(queueItems, account) {
  if (!db) init();
  const normalizedAccount = account || '';
  db.prepare('DELETE FROM sync_queue WHERE account = ?').run(normalizedAccount);
  if (!Array.isArray(queueItems) || queueItems.length === 0) return;
  const stmt = db.prepare('INSERT INTO sync_queue (account,recordId,op,resource,payload,createdAt,attemptCount,lastAttemptAt) VALUES(?,?,?,?,?,?,?,?)');
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      stmt.run(
        normalizedAccount,
        item.recordId || '',
        item.op || '',
        item.resource || '',
        serialize(item.payload),
        item.createdAt || new Date().toISOString(),
        item.attemptCount || 0,
        item.lastAttemptAt || null,
      );
    }
  });
  insertMany(queueItems);
}

function enqueueSync(op, payload, account) {
  if (!db) init();
  const normalizedAccount = account || '';
  const result = db.prepare('INSERT INTO sync_queue (account,recordId,op,resource,payload,createdAt) VALUES(?,?,?,?,?,?)').run(
    normalizedAccount,
    payload?.id || '',
    op,
    payload?.resource || '',
    serialize(payload),
    new Date().toISOString(),
  );
  return result.lastInsertRowid;
}

function getUploadQueue(account) {
  if (!db) init();
  const normalizedAccount = account || '';
  const rows = db.prepare('SELECT * FROM upload_queue WHERE account = ? ORDER BY qid ASC').all(normalizedAccount);
  return rows.map((row) => ({
    qid: row.qid,
    account: row.account,
    taskId: row.taskId,
    recordId: row.recordId,
    resource: row.resource,
    field: row.field,
    localUri: row.localUri,
    remoteUri: row.remoteUri,
    state: row.state,
    error: row.error,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function enqueueUploadTask(task, account) {
  if (!db) init();
  const normalizedAccount = account || '';
  const result = db.prepare('INSERT INTO upload_queue (account,taskId,recordId,resource,field,localUri,remoteUri,state,error,attemptCount,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
    normalizedAccount,
    task.taskId || '',
    task.recordId || '',
    task.resource || '',
    task.field || '',
    task.localUri || '',
    task.remoteUri || '',
    task.state || 'pending',
    task.error || '',
    task.attemptCount || 0,
    new Date().toISOString(),
    new Date().toISOString(),
  );
  return result.lastInsertRowid;
}

function updateUploadTask(qid, updates) {
  if (!db) init();
  const fields=[];
  const values=[];
  const allowed=['taskId','recordId','resource','field','localUri','remoteUri','state','error','attemptCount','updatedAt'];
  for(const key of allowed){
    if(updates[key] !== undefined){
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    }
  }
  if(fields.length===0) return;
  values.push(qid);
  db.prepare(`UPDATE upload_queue SET ${fields.join(', ')} WHERE qid = ?`).run(...values);
}

function removeUploadTask(qid) {
  if (!db) init();
  db.prepare('DELETE FROM upload_queue WHERE qid = ?').run(qid);
}

function getUnsyncedRecords(resource, account) {
  if (!db) init();
  const table = getResourceTable(resource);
  if (!table) return [];
  const normalizedAccount = account || '';
  const rows = db.prepare(`SELECT * FROM ${table} WHERE account = ? AND (syncStatus IS NULL OR syncStatus != 'synced' OR deletedAt IS NOT NULL) ORDER BY updatedAt ASC`).all(normalizedAccount);
  return rowsToRecords(rows);
}

function markRecordAsSynced(resource, id, account, lastSyncedAt) {
  if (!db) init();
  const table = getResourceTable(resource);
  if (!table || !id) return false;
  const normalizedAccount = account || '';
  const row = db.prepare(`SELECT * FROM ${table} WHERE account = ? AND id = ?`).get(normalizedAccount, id);
  if (!row) return false;
  const record = deserialize(row.payload) || {};
  record.syncStatus = 'synced';
  record.synced = true;
  const payload = serialize(record);
  db.prepare(`UPDATE ${table} SET payload = ?, syncStatus = ?, lastSyncedAt = ?, updatedAt = ? WHERE account = ? AND id = ?`).run(
    payload,
    'synced',
    lastSyncedAt || new Date().toISOString(),
    lastSyncedAt || new Date().toISOString(),
    normalizedAccount,
    id,
  );
  return true;
}

function setRecordDeleted(resource, id, account, deletedAt) {
  if (!db) init();
  const table = getResourceTable(resource);
  if (!table || !id) return false;
  const normalizedAccount = account || '';
  const row = db.prepare(`SELECT * FROM ${table} WHERE account = ? AND id = ?`).get(normalizedAccount, id);
  if (!row) return false;
  const record = deserialize(row.payload) || {};
  record.deletedAt = deletedAt || new Date().toISOString();
  const payload = serialize(record);
  db.prepare(`UPDATE ${table} SET payload = ?, deletedAt = ?, updatedAt = ? WHERE account = ? AND id = ?`).run(
    payload,
    deletedAt || new Date().toISOString(),
    deletedAt || new Date().toISOString(),
    normalizedAccount,
    id,
  );
  return true;
}

function appendLog(level, uid, code, message, meta) {
  if (!db) init();
  db.prepare('INSERT INTO sync_logs (ts,level,uid,code,message,meta) VALUES(?,?,?,?,?,?)').run(
    new Date().toISOString(),
    level,
    uid || '',
    code || '',
    message || '',
    serialize(meta || {}),
  );
}

module.exports = {
  init,
  get,
  set,
  del,
  getScoped,
  setScoped,
  deleteScoped,
  getRecords,
  upsertRecord,
  setRecords,
  deleteRecord,
  getSyncQueue,
  setSyncQueue,
  clearSyncQueue,
  enqueueSync,
  removeQueueItem,
  incrementQueueAttempt,
  getUploadQueue,
  enqueueUploadTask,
  updateUploadTask,
  removeUploadTask,
  getUnsyncedRecords,
  markRecordAsSynced,
  setRecordDeleted,
  appendLog,
};
