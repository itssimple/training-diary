// Import training history from CSV: one row per set. Pure (no DOM/DB), unit-tested.
// Recognises a documented generic format plus common column names used by other apps'
// exports (e.g. Strong, Hevy). Nothing is written until the caller commits the result.

import { uid } from './util.js';
import { exerciseSnapshot } from './model.js';

const LB_TO_KG = 0.45359237;

/** canonical field → accepted header names (compared lowercase, without spaces/punctuation) */
const COLUMNS = {
  date: ['date', 'workoutdate', 'starttime', 'start', 'datetime', 'startdate'],
  end: ['endtime', 'end', 'enddate'],
  workout: ['workout', 'workoutname', 'title', 'session', 'sessionname', 'routine'],
  duration: ['duration', 'workoutduration'],
  durationMin: ['durationmin', 'durationminutes', 'minutes'],
  durationSecs: ['durationsec', 'workoutdurationsec'],
  exercise: ['exercise', 'exercisename', 'exercisetitle'],
  setOrder: ['set', 'setorder', 'setindex', 'setnumber'],
  setType: ['settype', 'type'],
  weightKg: ['weightkg', 'weight', 'load', 'kg'],
  weightLb: ['weightlbs', 'weightlb', 'lbs', 'lb'],
  reps: ['reps', 'repetitions'],
  distanceKm: ['distancekm', 'distance', 'km'],
  seconds: ['seconds', 'durationseconds', 'timesec', 'setseconds'],
  rpe: ['rpe'],
  rir: ['rir'],
  notes: ['notes', 'exercisenotes', 'note', 'setnotes'],
  workoutNotes: ['workoutnotes', 'description', 'sessionnotes'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, (m) => m.replace(/[()]/g, '')).replace(/[^a-z0-9]/g, '');

/** RFC 4180-style parser. Detects , ; or tab from the header line. Returns string[][]. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => firstLine.split(ch).length - 1;
  const delim = [',', ';', '\t'].sort((a, b) => count(b) - count(a))[0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export function mapHeader(header) {
  const map = {};
  const used = new Set();
  const normalized = header.map(norm);
  // Exact alias matches; earlier aliases win so "weightkg" beats a generic "weight".
  for (const [field, aliases] of Object.entries(COLUMNS)) {
    for (const a of aliases) {
      const idx = normalized.findIndex((h, i) => h === a && !used.has(i));
      if (idx >= 0) { map[field] = idx; used.add(idx); break; }
    }
  }
  const unknown = header.filter((_, i) => !used.has(i) && header[i].trim());
  return { map, unknown };
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parse common date/time formats as local time. Returns ms, or null (ambiguous/invalid). */
export function parseDateTime(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let m;
  const mk = (y, mo, d, h = 0, mi = 0, se = 0) => {
    const dt = new Date(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(se));
    return dt.getMonth() === Number(mo) && dt.getDate() === Number(d) ? dt.getTime() : null;
  };
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(s) && /^\d{4}-/.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) return mk(m[1], m[2] - 1, m[3], m[4], m[5], m[6]);
  if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s))) return mk(m[3], m[2] - 1, m[1], m[4], m[5], m[6]);
  if ((m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mo === undefined ? null : mk(m[3], mo, m[1], m[4], m[5], m[6]);
  }
  if ((m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?/.exec(s))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mo === undefined ? null : mk(m[3], mo, m[2], m[4], m[5]);
  }
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2}))?$/.exec(s))) {
    const a = Number(m[1]); const b = Number(m[2]);
    if (a > 12 && b <= 12) return mk(m[3], b - 1, a, m[4], m[5]); // DD/MM/YYYY
    if (b > 12 && a <= 12) return mk(m[3], a - 1, b, m[4], m[5]); // MM/DD/YYYY
    return null; // ambiguous
  }
  return null;
}

/** "1h 5m", "45m", "1:05:00", "65 min", "3900s". Plain numbers are minutes. Returns seconds or null. */
export function parseLooseDuration(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
  const parts = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g)];
  if (parts.length) {
    return Math.round(parts.reduce((acc, [, n, u]) => {
      const v = Number(n.replace(',', '.'));
      return acc + (u.startsWith('h') ? v * 3600 : u.startsWith('m') ? v * 60 : v);
    }, 0));
  }
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : null;
}

function num(raw) {
  const s = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function setTypeOf(typeRaw, orderRaw) {
  const t = norm(typeRaw);
  if (['warmup', 'w', 'warm'].includes(t)) return 'warmup';
  if (['dropset', 'drop', 'd'].includes(t)) return 'drop';
  if (['failure', 'f', 'tofailure'].includes(t)) return 'failure';
  const o = norm(orderRaw);
  if (o === 'w') return 'warmup';
  if (o === 'd') return 'drop';
  if (o === 'f') return 'failure';
  return 'working';
}

function guessType(rows) {
  const has = (k) => rows.some((r) => Number.isFinite(r[k]) && r[k] > 0);
  if (has('distanceKm')) return 'cardio';
  if (has('weightKg') && has('reps')) return 'strength';
  if (has('reps')) return 'bodyweight';
  if (has('durationSec')) return 'timed';
  return 'other';
}

/**
 * Build sessions (and missing exercises) from CSV text.
 * opts: { exercises, sessions, weightUnit: 'kg' | 'lb', fileName, now }
 */
export function buildCsvImport(text, opts = {}) {
  const { exercises = [], sessions = [], weightUnit = 'kg', fileName = '', now = Date.now() } = opts;
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, errors: ['The file has no data rows.'], warnings: [] };
  const { map, unknown } = mapHeader(rows[0]);
  const errors = [];
  const warnings = [];
  if (map.date === undefined) errors.push('No date column found (expected e.g. "date" or "start_time").');
  if (map.exercise === undefined) errors.push('No exercise column found (expected e.g. "exercise" or "Exercise Name").');
  if (errors.length) return { ok: false, errors, warnings };
  if (unknown.length) warnings.push(`Ignored columns: ${unknown.join(', ')}`);
  const lbColumn = map.weightLb !== undefined && map.weightKg === undefined;
  const toKg = (v) => (weightUnit === 'lb' || lbColumn ? Math.round(v * LB_TO_KG * 100) / 100 : v);
  const get = (r, f) => (map[f] === undefined ? '' : (r[map[f]] ?? '').trim());

  const skipped = [];
  const groups = new Map();
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const dateRaw = get(r, 'date');
    const start = parseDateTime(dateRaw);
    const exName = get(r, 'exercise');
    if (!start) { skipped.push(`Row ${line}: date "${dateRaw}" not understood (use YYYY-MM-DD HH:MM)`); return; }
    if (!exName) { skipped.push(`Row ${line}: no exercise name`); return; }
    const vals = {
      weightKg: num(get(r, map.weightKg !== undefined ? 'weightKg' : 'weightLb')),
      reps: num(get(r, 'reps')),
      distanceKm: num(get(r, 'distanceKm')),
      durationSec: num(get(r, 'seconds')),
      rpe: num(get(r, 'rpe')),
      rir: num(get(r, 'rir')),
    };
    const bad = Object.entries(vals).filter(([, v]) => Number.isNaN(v) || (Number.isFinite(v) && v < 0)).map(([k]) => k);
    if (bad.length) { skipped.push(`Row ${line}: invalid number in ${bad.join(', ')}`); return; }
    if (Number.isFinite(vals.weightKg)) vals.weightKg = toKg(vals.weightKg);
    const empty = ['weightKg', 'reps', 'distanceKm', 'durationSec'].every((k) => !Number.isFinite(vals[k]) || vals[k] === 0);
    if (empty) { skipped.push(`Row ${line}: no weight, reps, distance or time`); return; }
    const workout = get(r, 'workout') || 'Imported workout';
    const key = `${start}|${workout.toLowerCase()}`;
    if (!groups.has(key)) {
      const end = parseDateTime(get(r, 'end'));
      const secs = num(get(r, 'durationSecs'));
      let dur = Number.isFinite(secs) ? secs : get(r, 'durationMin') ? parseLooseDuration(get(r, 'durationMin')) : parseLooseDuration(get(r, 'duration'));
      if (end && end > start) dur = Math.round((end - start) / 1000);
      groups.set(key, { start, workout, durationSec: dur, notes: get(r, 'workoutNotes'), rows: [] });
    }
    groups.get(key).rows.push({ exName, kind: setTypeOf(get(r, 'setType'), get(r, 'setOrder')), note: get(r, 'notes'), ...vals });
  });

  // Exercises: match by name (case/punctuation-insensitive), otherwise create.
  const byName = new Map(exercises.map((e) => [norm(e.name), e]));
  const created = new Map();
  const allRows = [...groups.values()].flatMap((g) => g.rows);
  for (const name of [...new Set(allRows.map((r) => r.exName))]) {
    const k = norm(name);
    if (byName.has(k) || created.has(k)) continue;
    created.set(k, {
      id: uid('ex'), name, description: '', category: 'Other', equipment: 'Other',
      type: guessType(allRows.filter((r) => norm(r.exName) === k)),
      muscles: [], instructions: '', notes: `Created by CSV import${fileName ? ` (${fileName})` : ''}.`, alternativeIds: [],
      defaultRestSec: null, cardioDisplay: null, isActivity: false, archived: false, meta: [], weightMode: 'total', lowerIsBetter: false,
      builtIn: false, createdAt: now, updatedAt: now,
    });
  }
  for (const e of created.values()) if (e.type === 'cardio') e.cardioDisplay = 'pace';
  const exFor = (name) => byName.get(norm(name)) || created.get(norm(name));

  // Skip workouts that already exist (same start time and name), so re-importing is safe.
  const existing = new Set(sessions.filter((s) => s.kind === 'workout').map((s) => `${s.startedAt}|${(s.name || '').toLowerCase()}`));
  const out = [];
  let duplicates = 0;
  let setCount = 0;
  for (const [key, g] of [...groups.entries()].sort((a, b) => a[1].start - b[1].start)) {
    if (existing.has(key)) { duplicates++; continue; }
    const entries = [];
    const byEx = new Map();
    for (const r of g.rows) {
      const ex = exFor(r.exName);
      if (!byEx.has(ex.id)) {
        const snap = exerciseSnapshot(ex);
        const entry = {
          id: uid('ent'), groupId: null, templateItemId: null, plannedExerciseId: null, plannedExercise: null,
          exerciseId: ex.id, exercise: snap, substitution: null, adHoc: false, imported: true, status: 'done',
          restSec: null, planNotes: '', notes: '', alternativeIds: [], sets: [],
        };
        byEx.set(ex.id, entry);
        entries.push(entry);
      }
      const entry = byEx.get(ex.id);
      const actual = {};
      for (const f of ['weightKg', 'reps', 'distanceKm', 'durationSec', 'rpe', 'rir']) if (Number.isFinite(r[f]) && (r[f] > 0 || (f === 'weightKg' && r.reps > 0))) actual[f] = r[f];
      const set = { id: uid('set'), planned: null, actual, done: true, doneAt: g.start, note: r.note || '' };
      if (r.kind !== 'working') set.kind = r.kind;
      entry.sets.push(set);
      setCount++;
    }
    const durationSec = Number.isFinite(g.durationSec) && g.durationSec > 0 ? g.durationSec : null;
    out.push({
      id: uid('ses'), kind: 'workout', status: 'completed', name: g.workout,
      programId: null, programName: null, templateId: null, templateName: null,
      startedAt: g.start, endedAt: durationSec ? g.start + durationSec * 1000 : g.start,
      pausedAt: null, pausedMs: 0, notes: g.notes || '', groups: [], entries, rest: null, focusEntryId: null,
      imported: { source: 'csv', fileName, at: now },
      createdAt: now, updatedAt: now,
    });
  }
  if (!out.length && !duplicates) errors.push('No workouts could be read from the file.');
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    skipped,
    sessions: out,
    newExercises: [...created.values()],
    stats: {
      workouts: out.length,
      sets: setCount,
      duplicates,
      from: out[0]?.startedAt ?? null,
      to: out[out.length - 1]?.startedAt ?? null,
    },
  };
}

/** Example file for people transcribing a paper diary into a spreadsheet. */
export function exampleCsv() {
  return [
    'date,workout,duration_min,exercise,set_type,weight_kg,reps,distance_km,seconds,rpe,notes',
    '2025-03-03 18:30,Full body A,55,Barbell back squat,warmup,40,8,,,,',
    '2025-03-03 18:30,Full body A,55,Barbell back squat,,80,5,,,8,',
    '2025-03-03 18:30,Full body A,55,Barbell back squat,,80,5,,,8.5,felt heavy',
    '2025-03-03 18:30,Full body A,55,Dumbbell bench press,,22,10,,,,22 kg per dumbbell',
    '2025-03-03 18:30,Full body A,55,Plank,,,,,60,,',
    '2025-03-03 18:30,Full body A,55,Treadmill,,,,2.5,900,,',
    '',
  ].join('\n');
}
