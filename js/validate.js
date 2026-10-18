// Structural validation for stored/imported data. Hand-written to avoid dependencies.
// Errors block an import; warnings are reported but do not.

import { EXERCISE_TYPES, SET_FIELDS, GROUP_TYPES } from './model.js';

const MAX_ERRORS = 25;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 200;
const isNumOrNull = (v) => v === null || v === undefined || (typeof v === 'number' && Number.isFinite(v));
const isTs = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

function makeCollector() {
  const errors = [];
  const warnings = [];
  return {
    errors,
    warnings,
    err(path, msg) { if (errors.length < MAX_ERRORS) errors.push(`${path}: ${msg}`); },
    warn(path, msg) { if (warnings.length < MAX_ERRORS) warnings.push(`${path}: ${msg}`); },
    full() { return errors.length >= MAX_ERRORS; },
  };
}

function checkIds(list, name, c) {
  const seen = new Set();
  list.forEach((r, i) => {
    if (!isObj(r)) { c.err(`${name}[${i}]`, 'must be an object'); return; }
    if (!isId(r.id)) c.err(`${name}[${i}].id`, 'missing or invalid id');
    else if (seen.has(r.id)) c.err(`${name}[${i}].id`, `duplicate id "${r.id}"`);
    else seen.add(r.id);
  });
  return seen;
}

function checkValues(obj, path, c) {
  if (obj === null || obj === undefined) return;
  if (!isObj(obj)) { c.err(path, 'must be an object or null'); return; }
  for (const f of SET_FIELDS) {
    if (f in obj && !isNumOrNull(obj[f])) c.err(`${path}.${f}`, 'must be a number');
    if (Number.isFinite(obj[f]) && obj[f] < 0) c.err(`${path}.${f}`, 'must not be negative');
  }
}

function validateExercise(ex, i, c) {
  const p = `exercises[${i}]`;
  if (!isStr(ex.name) || !ex.name.trim()) c.err(`${p}.name`, 'name is required');
  if (!(ex.type in EXERCISE_TYPES)) c.err(`${p}.type`, `unknown type "${ex.type}"`);
  if ('muscles' in ex && !Array.isArray(ex.muscles)) c.err(`${p}.muscles`, 'must be a list');
  if ('alternativeIds' in ex && !Array.isArray(ex.alternativeIds)) c.err(`${p}.alternativeIds`, 'must be a list');
  if ('defaultRestSec' in ex && !isNumOrNull(ex.defaultRestSec)) c.err(`${p}.defaultRestSec`, 'must be a number');
  if ('meta' in ex && ex.meta !== null && !Array.isArray(ex.meta)) c.err(`${p}.meta`, 'must be a list');
}

function validateTemplate(t, i, programIds, exerciseIds, c) {
  const p = `templates[${i}]`;
  if (!isStr(t.name) || !t.name.trim()) c.err(`${p}.name`, 'name is required');
  if (t.programId !== null && t.programId !== undefined && !programIds.has(t.programId)) c.warn(`${p}.programId`, 'refers to a program that is not in the file');
  if (!Array.isArray(t.items)) { c.err(`${p}.items`, 'must be a list'); return; }
  if ('groups' in t && !Array.isArray(t.groups)) c.err(`${p}.groups`, 'must be a list');
  const groupIds = new Set((Array.isArray(t.groups) ? t.groups : []).map((g) => g && g.id));
  (Array.isArray(t.groups) ? t.groups : []).forEach((g, gi) => {
    if (!isObj(g) || !isId(g.id)) c.err(`${p}.groups[${gi}]`, 'invalid group');
    else if (!(g.type in GROUP_TYPES)) c.err(`${p}.groups[${gi}].type`, `unknown group type "${g.type}"`);
  });
  t.items.forEach((it, j) => {
    const ip = `${p}.items[${j}]`;
    if (!isObj(it)) { c.err(ip, 'must be an object'); return; }
    if (!isId(it.id)) c.err(`${ip}.id`, 'missing id');
    if (!isId(it.exerciseId)) c.err(`${ip}.exerciseId`, 'missing exercise reference');
    else if (!exerciseIds.has(it.exerciseId)) c.warn(`${ip}.exerciseId`, `exercise "${it.exerciseName || it.exerciseId}" is not in the library`);
    for (const f of ['sets', 'restSec', ...SET_FIELDS]) if (f in it && !isNumOrNull(it[f])) c.err(`${ip}.${f}`, 'must be a number');
    if (it.groupId && !groupIds.has(it.groupId)) c.err(`${ip}.groupId`, 'refers to an unknown group');
  });
}

function validateSession(s, i, c) {
  const p = `sessions[${i}]`;
  if (s.kind !== 'workout' && s.kind !== 'activity') c.err(`${p}.kind`, 'must be "workout" or "activity"');
  if (s.status !== 'active' && s.status !== 'completed') c.err(`${p}.status`, 'must be "active" or "completed"');
  if (!isTs(s.startedAt)) c.err(`${p}.startedAt`, 'must be a timestamp');
  if (s.endedAt !== null && s.endedAt !== undefined && !isTs(s.endedAt)) c.err(`${p}.endedAt`, 'must be a timestamp or null');
  if (s.kind === 'activity') {
    const a = s.activity;
    if (!isObj(a)) { c.err(`${p}.activity`, 'activity details are required'); return; }
    for (const f of ['durationSec', 'distanceKm', 'elevationM', 'calories', 'avgHr', 'maxHr']) {
      if (f in a && !isNumOrNull(a[f])) c.err(`${p}.activity.${f}`, 'must be a number');
    }
    if (!isObj(a.exercise) || !isStr(a.exercise.name)) c.err(`${p}.activity.exercise`, 'activity name snapshot is required');
    if ('extra' in a && !Array.isArray(a.extra)) c.err(`${p}.activity.extra`, 'must be a list');
    return;
  }
  if (!Array.isArray(s.entries)) { c.err(`${p}.entries`, 'must be a list'); return; }
  if ('groups' in s && !Array.isArray(s.groups)) c.err(`${p}.groups`, 'must be a list');
  s.entries.forEach((e, j) => {
    const ep = `${p}.entries[${j}]`;
    if (!isObj(e)) { c.err(ep, 'must be an object'); return; }
    if (!isId(e.id)) c.err(`${ep}.id`, 'missing id');
    if (!isId(e.exerciseId)) c.err(`${ep}.exerciseId`, 'missing exercise reference');
    if (!isObj(e.exercise) || !isStr(e.exercise.name)) c.err(`${ep}.exercise`, 'exercise name snapshot is required');
    if (!['pending', 'done', 'skipped'].includes(e.status)) c.err(`${ep}.status`, `unknown status "${e.status}"`);
    if (!Array.isArray(e.sets)) { c.err(`${ep}.sets`, 'must be a list'); return; }
    e.sets.forEach((st, k) => {
      const sp = `${ep}.sets[${k}]`;
      if (!isObj(st)) { c.err(sp, 'must be an object'); return; }
      if (typeof st.done !== 'boolean') c.err(`${sp}.done`, 'must be true or false');
      checkValues(st.planned, `${sp}.planned`, c);
      checkValues(st.actual, `${sp}.actual`, c);
    });
  });
}

function validateMeasurement(m, i, c) {
  const p = `measurements[${i}]`;
  if (!isId(m.typeId)) c.err(`${p}.typeId`, 'measurement type is required');
  if (!isTs(m.date)) c.err(`${p}.date`, 'must be a timestamp');
  if (typeof m.value !== 'number' || !Number.isFinite(m.value)) c.err(`${p}.value`, 'must be a number');
  if (!isStr(m.unit)) c.err(`${p}.unit`, 'unit is required');
}

function validateSettings(st, c) {
  if (st === null || st === undefined) return;
  if (!isObj(st)) { c.err('settings', 'must be an object'); return; }
  for (const f of ['defaultRestSec', 'weeklyGoal', 'weekStart', 'targetBodyWeightKg', 'weeklyDistanceGoalKm', 'lastExportAt']) {
    if (f in st && !isNumOrNull(st[f])) c.err(`settings.${f}`, 'must be a number');
  }
  if ('measurementTypes' in st) {
    if (!Array.isArray(st.measurementTypes)) c.err('settings.measurementTypes', 'must be a list');
    else st.measurementTypes.forEach((t, i) => {
      if (!isObj(t) || !isId(t.id) || !isStr(t.label) || !isStr(t.unit)) c.err(`settings.measurementTypes[${i}]`, 'needs id, label and unit');
    });
  }
}

/** Validate a full data set ({exercises, programs, templates, sessions, measurements, settings}). */
export function validateData(data) {
  const c = makeCollector();
  if (!isObj(data)) { c.err('data', 'must be an object'); return { errors: c.errors, warnings: c.warnings }; }
  for (const key of ['exercises', 'programs', 'templates', 'sessions', 'measurements']) {
    if (!(key in data)) { data[key] = []; c.warn(key, 'missing, treated as empty'); }
    if (!Array.isArray(data[key])) c.err(key, 'must be a list');
  }
  if (c.errors.length) return { errors: c.errors, warnings: c.warnings };

  const exerciseIds = checkIds(data.exercises, 'exercises', c);
  const programIds = checkIds(data.programs, 'programs', c);
  checkIds(data.templates, 'templates', c);
  checkIds(data.sessions, 'sessions', c);
  checkIds(data.measurements, 'measurements', c);

  data.exercises.forEach((ex, i) => { if (isObj(ex) && !c.full()) validateExercise(ex, i, c); });
  data.programs.forEach((pr, i) => {
    if (isObj(pr) && (!isStr(pr.name) || !pr.name.trim())) c.err(`programs[${i}].name`, 'name is required');
  });
  data.templates.forEach((t, i) => { if (isObj(t) && !c.full()) validateTemplate(t, i, programIds, exerciseIds, c); });
  data.sessions.forEach((s, i) => { if (isObj(s) && !c.full()) validateSession(s, i, c); });
  data.measurements.forEach((m, i) => { if (isObj(m) && !c.full()) validateMeasurement(m, i, c); });
  validateSettings(data.settings, c);

  const active = data.sessions.filter((s) => isObj(s) && s.status === 'active');
  if (active.length > 1) c.warn('sessions', `${active.length} unfinished workouts found; only the most recent can be resumed`);
  if (c.full()) c.errors.push(`…stopped after ${MAX_ERRORS} errors.`);
  return { errors: c.errors, warnings: c.warnings };
}
