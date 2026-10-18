// In-memory cache of all user data, backed by IndexedDB.
// Personal training data is small (thousands of records at most), so loading everything at
// startup keeps the UI simple and fast. Every mutation is written to IndexedDB immediately.

import * as db from './db.js';
import { withDefaults } from './model.js';
import { starterExercises, starterProgram } from './seed.js';
import { byOrder } from './util.js';

export const state = {
  exercises: [],
  programs: [],
  templates: [],
  sessions: [],
  measurements: [],
  settings: withDefaults(null),
  loaded: false,
};

let exIndex = new Map();
const listeners = new Set();
let saveErrorHandler = (e) => console.error(e);

export function onSaveError(fn) { saveErrorHandler = fn; }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(what) { for (const fn of listeners) fn(what); }

function reindex() { exIndex = new Map(state.exercises.map((e) => [e.id, e])); }

export async function loadAll() {
  const migration = await db.ensureSchema();
  const data = await db.readAllData();
  if (!data.meta) {
    // First launch on this device: create starter content once.
    const now = Date.now();
    const exercises = starterExercises(now);
    const { program, templates } = starterProgram(now);
    await db.replaceAllData({ exercises, programs: [program], templates, sessions: [], measurements: [], settings: withDefaults(null) }, { seededAt: now, createdAt: now });
    return loadAll();
  }
  state.exercises = data.exercises;
  state.programs = data.programs;
  state.templates = data.templates;
  state.sessions = data.sessions;
  state.measurements = data.measurements;
  state.settings = withDefaults(data.settings);
  state.meta = data.meta;
  state.loaded = true;
  reindex();
  return { migratedFrom: migration.migratedFrom || null };
}

async function guarded(fn) {
  try {
    return await fn();
  } catch (e) {
    saveErrorHandler(e);
    throw e;
  }
}

function upsert(list, rec) {
  const i = list.findIndex((r) => r.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
}

// ---------- exercises ----------

export const exerciseById = (id) => exIndex.get(id) || null;

export function exercisesSorted({ includeArchived = false } = {}) {
  return state.exercises
    .filter((e) => includeArchived || !e.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveExercise(ex) {
  ex.updatedAt = Date.now();
  if (!ex.createdAt) ex.createdAt = ex.updatedAt;
  await guarded(() => db.put('exercises', ex));
  upsert(state.exercises, ex);
  reindex();
  emit('exercises');
  return ex;
}

/** Templates that reference an exercise (as main exercise or alternative). */
export function exerciseUsage(id) {
  const templates = state.templates.filter((t) => (t.items || []).some((i) => i.exerciseId === id || (i.alternativeIds || []).includes(id)));
  const sessions = state.sessions.filter((s) => (s.entries || []).some((e) => e.exerciseId === id || e.plannedExerciseId === id) || s.activity?.exerciseId === id);
  return { templates, sessions };
}

/** Deleting removes the library entry only. Sessions keep their snapshots; templates keep the stored name. */
export async function deleteExercise(id) {
  const others = state.exercises.filter((e) => e.id !== id && (e.alternativeIds || []).includes(id));
  await guarded(() => db.atomic(['exercises'], (t) => {
    t.del('exercises', id);
    for (const o of others) t.put('exercises', { ...o, alternativeIds: o.alternativeIds.filter((a) => a !== id), updatedAt: Date.now() });
  }));
  state.exercises = state.exercises.filter((e) => e.id !== id).map((e) => (others.some((o) => o.id === e.id) ? { ...e, alternativeIds: e.alternativeIds.filter((a) => a !== id) } : e));
  reindex();
  emit('exercises');
}

export async function restoreStarterExercises() {
  const existing = new Set(state.exercises.map((e) => e.id));
  const missing = starterExercises(Date.now()).filter((e) => !existing.has(e.id));
  if (missing.length) {
    await guarded(() => db.putMany('exercises', missing));
    state.exercises.push(...missing);
    reindex();
    emit('exercises');
  }
  return missing.length;
}

// ---------- programs & templates ----------

export const programById = (id) => state.programs.find((p) => p.id === id) || null;
export const templateById = (id) => state.templates.find((t) => t.id === id) || null;
export const programsSorted = () => [...state.programs].sort(byOrder);
export const templatesFor = (programId) => state.templates.filter((t) => t.programId === programId).sort(byOrder);

export async function saveProgram(p) {
  p.updatedAt = Date.now();
  if (!p.createdAt) p.createdAt = p.updatedAt;
  await guarded(() => db.put('programs', p));
  upsert(state.programs, p);
  emit('programs');
  return p;
}

export async function deleteProgram(id) {
  const tpls = templatesFor(id);
  await guarded(() => db.atomic(['programs', 'templates'], (t) => {
    t.del('programs', id);
    for (const tp of tpls) t.del('templates', tp.id);
  }));
  state.programs = state.programs.filter((p) => p.id !== id);
  state.templates = state.templates.filter((t) => t.programId !== id);
  emit('programs');
}

export async function saveTemplate(t) {
  t.updatedAt = Date.now();
  if (!t.createdAt) t.createdAt = t.updatedAt;
  await guarded(() => db.put('templates', t));
  upsert(state.templates, t);
  emit('templates');
  return t;
}

export async function saveTemplates(list) {
  const now = Date.now();
  for (const t of list) t.updatedAt = now;
  await guarded(() => db.putMany('templates', list));
  for (const t of list) upsert(state.templates, t);
  emit('templates');
}

export async function deleteTemplate(id) {
  await guarded(() => db.del('templates', id));
  state.templates = state.templates.filter((t) => t.id !== id);
  emit('templates');
}

// ---------- sessions ----------

export const sessionById = (id) => state.sessions.find((s) => s.id === id) || null;

export function activeSession() {
  return state.sessions.filter((s) => s.status === 'active').sort((a, b) => b.startedAt - a.startedAt)[0] || null;
}

export function completedSessions() {
  return state.sessions.filter((s) => s.status === 'completed').sort((a, b) => b.startedAt - a.startedAt);
}

export async function saveSession(s) {
  await guarded(() => db.put('sessions', s));
  upsert(state.sessions, s);
  emit('sessions');
  return s;
}

export async function deleteSession(id) {
  await guarded(() => db.del('sessions', id));
  state.sessions = state.sessions.filter((s) => s.id !== id);
  emit('sessions');
}

/** Add imported exercises and sessions in one transaction (all or nothing). */
export async function importBundle({ exercises = [], sessions = [] }) {
  await guarded(() => db.atomic(['exercises', 'sessions'], (t) => {
    for (const e of exercises) t.put('exercises', e);
    for (const s of sessions) t.put('sessions', s);
  }));
  state.exercises.push(...exercises);
  state.sessions.push(...sessions);
  reindex();
  emit('all');
}

// ---------- measurements ----------

export async function saveMeasurement(m) {
  await guarded(() => db.put('measurements', m));
  upsert(state.measurements, m);
  emit('measurements');
}

export async function deleteMeasurement(id) {
  await guarded(() => db.del('measurements', id));
  state.measurements = state.measurements.filter((m) => m.id !== id);
  emit('measurements');
}

// ---------- settings ----------

export async function saveSettings(patch) {
  const next = withDefaults({ ...state.settings, ...patch, id: 'prefs' });
  await guarded(() => db.put('settings', next));
  state.settings = next;
  emit('settings');
  return next;
}

// ---------- bulk ----------

export function snapshotData() {
  return {
    exercises: state.exercises,
    programs: state.programs,
    templates: state.templates,
    sessions: state.sessions,
    measurements: state.measurements,
    settings: state.settings,
  };
}

export async function replaceAll(data) {
  await guarded(() => db.replaceAllData(data, { importedAt: Date.now() }));
  await loadAll();
  emit('all');
}

export async function wipeAll() {
  await guarded(() => db.deleteAllData());
  await loadAll(); // re-seeds starter content as on first launch
  emit('all');
}
