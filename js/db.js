// IndexedDB persistence. All structured user data lives here (never in localStorage).
//
// Two kinds of versioning:
//  - DB_VERSION + STORE_UPGRADES: IndexedDB object stores/indexes (structure).
//  - SCHEMA_VERSION (model.js) + migrations.js: shape of records. Stored in the "meta" record.
// Upgrades only ever add; existing stores are never deleted or cleared by an upgrade.

import { SCHEMA_VERSION } from './model.js';
import { migrateData, DATA_KEYS } from './migrations.js';

export const DB_NAME = 'training-diary';
export const DB_VERSION = 1;
export const STORES = [...DATA_KEYS, 'settings', 'meta'];

/** STORE_UPGRADES[n] upgrades the database structure from version n - 1 to n. */
const STORE_UPGRADES = {
  1: (db) => {
    db.createObjectStore('exercises', { keyPath: 'id' });
    db.createObjectStore('programs', { keyPath: 'id' });
    const templates = db.createObjectStore('templates', { keyPath: 'id' });
    templates.createIndex('programId', 'programId');
    const sessions = db.createObjectStore('sessions', { keyPath: 'id' });
    sessions.createIndex('startedAt', 'startedAt');
    sessions.createIndex('status', 'status');
    const measurements = db.createObjectStore('measurements', { keyPath: 'id' });
    measurements.createIndex('date', 'date');
    db.createObjectStore('settings', { keyPath: 'id' });
    db.createObjectStore('meta', { keyPath: 'id' });
  },
};

let dbPromise = null;
let onVersionChange = () => {};

export function setVersionChangeHandler(fn) {
  onVersionChange = fn;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('This browser does not support IndexedDB, which the app needs to store your data.'));
      return;
    }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = (ev) => {
      const db = r.result;
      for (let v = ev.oldVersion + 1; v <= DB_VERSION; v++) STORE_UPGRADES[v]?.(db, r.transaction);
    };
    r.onblocked = () => reject(new Error('The database upgrade is blocked by another open tab of this app. Close other tabs and reload.'));
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
        onVersionChange();
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error || new Error('Could not open the database.'));
  });
  return dbPromise;
}

export async function getAll(store) {
  const db = await openDB();
  return req(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await openDB();
  return req(db.transaction(store, 'readonly').objectStore(store).get(id));
}

export async function put(store, value) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  await txDone(tx);
  return value;
}

export async function putMany(store, values) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  const os = tx.objectStore(store);
  for (const v of values) os.put(v);
  await txDone(tx);
}

export async function del(store, id) {
  const db = await openDB();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(id);
  await txDone(tx);
}

/** Run several writes across stores atomically. fn receives { put(store, v), del(store, id) }. */
export async function atomic(stores, fn) {
  const db = await openDB();
  const tx = db.transaction(stores, 'readwrite');
  const api = {
    put: (s, v) => tx.objectStore(s).put(v),
    del: (s, id) => tx.objectStore(s).delete(id),
    clear: (s) => tx.objectStore(s).clear(),
  };
  try {
    fn(api);
  } catch (e) {
    tx.abort();
    throw e;
  }
  await txDone(tx);
}

export async function readAllData() {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readonly');
  const out = {};
  await Promise.all(DATA_KEYS.map(async (k) => { out[k] = await req(tx.objectStore(k).getAll()); }));
  out.settings = (await req(tx.objectStore('settings').get('prefs'))) || null;
  out.meta = (await req(tx.objectStore('meta').get('meta'))) || null;
  return out;
}

/**
 * Replace all data in one transaction. If anything fails the transaction aborts
 * and the previous data stays exactly as it was.
 */
export async function replaceAllData(data, metaPatch = {}) {
  const meta = (await get('meta', 'meta')) || { id: 'meta' };
  await atomic(STORES, (t) => {
    for (const k of DATA_KEYS) {
      t.clear(k);
      for (const r of data[k] || []) t.put(k, r);
    }
    if (data.settings) { t.clear('settings'); t.put('settings', { ...data.settings, id: 'prefs' }); }
    t.put('meta', { ...meta, schemaVersion: SCHEMA_VERSION, ...metaPatch, id: 'meta' });
  });
}

export async function deleteAllData() {
  await atomic(STORES, (t) => { for (const s of STORES) t.clear(s); });
}

/**
 * Bring stored records up to SCHEMA_VERSION. A copy of the pre-migration data is kept in the
 * meta store so an unexpected migration problem never loses data.
 */
export async function ensureSchema() {
  const meta = await get('meta', 'meta');
  if (!meta) return { fresh: true };
  const from = meta.schemaVersion || 1;
  if (from === SCHEMA_VERSION) return { fresh: false };
  const data = await readAllData();
  const migrated = migrateData({ ...data }, from);
  await put('meta', { id: 'pre-migration-backup', fromVersion: from, createdAt: Date.now(), data: { ...data, meta: undefined } });
  await replaceAllData(migrated, { migratedFrom: from, migratedAt: Date.now() });
  return { fresh: false, migratedFrom: from };
}

export async function storageInfo() {
  const out = { persisted: null, usage: null, quota: null };
  try {
    if (navigator.storage?.persisted) out.persisted = await navigator.storage.persisted();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      out.usage = e.usage ?? null;
      out.quota = e.quota ?? null;
    }
  } catch { /* not supported */ }
  return out;
}

export async function requestPersistence() {
  try {
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}
