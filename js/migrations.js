// Data-shape migrations. Used both when the app starts with older data in IndexedDB
// and when importing an older export file.
//
// To change the stored shape:
//   1. bump SCHEMA_VERSION in model.js,
//   2. add DATA_MIGRATIONS[oldVersion] = (data) => newData (pure, must not drop unknown fields),
//   3. add a unit test with a fixture of the old shape.
// IndexedDB structure changes (new stores/indexes) go into db.js STORE_UPGRADES instead.

import { SCHEMA_VERSION } from './model.js';

/** DATA_MIGRATIONS[n] converts data of version n to version n + 1. */
export const DATA_MIGRATIONS = {
  // Example for a future version:
  // 1: (data) => ({ ...data, sessions: data.sessions.map((s) => ({ ...s, newField: s.newField ?? null })) }),
};

export const DATA_KEYS = ['exercises', 'programs', 'templates', 'sessions', 'measurements'];

export function emptyData() {
  return { exercises: [], programs: [], templates: [], sessions: [], measurements: [], settings: null };
}

/**
 * Apply migrations from `fromVersion` up to `toVersion`.
 * Throws if a step is missing, so data is never silently treated as a shape it is not.
 */
export function migrateData(data, fromVersion, toVersion = SCHEMA_VERSION, migrations = DATA_MIGRATIONS) {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error(`Unknown data version: ${fromVersion}`);
  if (fromVersion > toVersion) throw new Error(`This data was created by a newer version of the app (data version ${fromVersion}, app supports ${toVersion}). Update the app before importing.`);
  let out = data;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations[v];
    if (typeof step !== 'function') throw new Error(`No migration available from data version ${v} to ${v + 1}.`);
    out = step(structuredClone(out));
  }
  return out;
}
