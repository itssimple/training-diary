// Export / import format handling (pure; the DB write happens in db.js).

import { APP_ID, SCHEMA_VERSION } from './model.js';
import { migrateData, DATA_KEYS } from './migrations.js';
import { validateData } from './validate.js';
import { isoDate } from './util.js';

export const EXPORT_FORMAT = 'training-diary-export';

export function buildExport(data, appVersion, now = Date.now()) {
  const out = {
    format: EXPORT_FORMAT,
    app: APP_ID,
    appVersion,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    data: {},
  };
  for (const key of DATA_KEYS) out.data[key] = structuredClone(data[key] || []);
  out.data.settings = data.settings ? structuredClone(data.settings) : null;
  return out;
}

export function exportFileName(now = Date.now()) {
  return `training-diary-backup-${isoDate(now)}.json`;
}

/**
 * Parse and validate an export file's text.
 * Returns { ok: true, data, warnings, schemaVersion, counts } or { ok: false, errors, warnings }.
 * Never touches stored data.
 */
export function parseImport(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`The file is not valid JSON (${e.message}).`], warnings: [] };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, errors: ['The file does not contain a Training Diary export.'], warnings: [] };
  }
  if (json.format !== EXPORT_FORMAT || json.app !== APP_ID) {
    return { ok: false, errors: ['This is not a Training Diary export file (missing "format"/"app" markers).'], warnings: [] };
  }
  if (!Number.isInteger(json.schemaVersion)) {
    return { ok: false, errors: ['The export has no valid "schemaVersion".'], warnings: [] };
  }
  if (!json.data || typeof json.data !== 'object') {
    return { ok: false, errors: ['The export has no "data" section.'], warnings: [] };
  }
  let data;
  try {
    data = migrateData(structuredClone(json.data), json.schemaVersion);
  } catch (e) {
    return { ok: false, errors: [e.message], warnings: [] };
  }
  const { errors, warnings } = validateData(data);
  if (errors.length) return { ok: false, errors, warnings };
  const counts = {};
  for (const key of DATA_KEYS) counts[key] = data[key].length;
  return { ok: true, data, warnings, schemaVersion: json.schemaVersion, exportedAt: json.exportedAt || null, counts };
}

/**
 * Merge imported data into existing data by id. Imported records win on id conflicts,
 * except that an imported unfinished workout is not added while a local one is in progress
 * (reported via skippedActive so the UI can say so). Local settings are kept.
 */
export function mergeData(existing, incoming) {
  const out = {};
  for (const key of DATA_KEYS) {
    const map = new Map((existing[key] || []).map((r) => [r.id, r]));
    for (const r of incoming[key] || []) map.set(r.id, r);
    out[key] = [...map.values()];
  }
  const localActive = (existing.sessions || []).filter((s) => s.status === 'active').map((s) => s.id);
  const skipped = [];
  if (localActive.length) {
    out.sessions = out.sessions.filter((s) => {
      const keep = s.status !== 'active' || localActive.includes(s.id);
      if (!keep) skipped.push(s);
      return keep;
    });
  }
  out.settings = existing.settings || incoming.settings || null;
  return { data: out, skippedActive: skipped.length };
}
