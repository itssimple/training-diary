// Domain constants and pure calculations (stats, records, goals).
// No DOM or IndexedDB access here: these functions are unit-tested under Node.

import { startOfWeek, addDays } from './util.js';

/** Version of the data shape stored in IndexedDB and written to exports. */
export const SCHEMA_VERSION = 2;
export const APP_ID = 'training-diary';

/**
 * Exercise types decide which values are recorded per set.
 * Units are explicit in field names: weightKg, reps, durationSec, distanceKm.
 */
export const EXERCISE_TYPES = {
  strength: { label: 'Strength (weight × reps)', fields: ['weightKg', 'reps'] },
  bodyweight: { label: 'Bodyweight (reps, optional added weight)', fields: ['weightKg', 'reps'] },
  timed: { label: 'Timed (hold / duration)', fields: ['durationSec'] },
  cardio: { label: 'Cardio (duration & distance)', fields: ['durationSec', 'distanceKm'] },
  other: { label: 'Other (reps and/or duration)', fields: ['reps', 'durationSec'] },
};

export const SET_FIELDS = ['weightKg', 'reps', 'durationSec', 'distanceKm'];
/** Optional per-set effort ratings (recorded in set.actual, never pre-filled from a plan). */
export const EFFORT_FIELDS = ['rpe', 'rir'];
/** Extra planned-only field: top of a rep range ("8–12" is reps 8, repsMax 12). */
export const PLAN_FIELDS = [...SET_FIELDS, 'repsMax'];

/** Set types. Warm-up sets are recorded but excluded from volume, set counts, progress and records. */
export const SET_KINDS = {
  working: { label: 'Working set', short: '' },
  warmup: { label: 'Warm-up', short: 'W' },
  drop: { label: 'Drop set', short: 'D' },
  failure: { label: 'To failure', short: 'F' },
};
export const setKind = (set) => (set && SET_KINDS[set.kind] ? set.kind : 'working');

/** How the weight of an exercise is entered. perHand: weight of ONE dumbbell, used in each hand. */
export const WEIGHT_MODES = {
  total: 'Total weight',
  perHand: 'Per hand (each dumbbell)',
};

export const FIELD_META = {
  weightKg: { label: 'Weight', unit: 'kg', short: 'kg' },
  reps: { label: 'Reps', unit: 'reps', short: 'reps' },
  durationSec: { label: 'Time', unit: 's', short: 'time' },
  distanceKm: { label: 'Distance', unit: 'km', short: 'km' },
};

export const CATEGORIES = ['Legs', 'Chest', 'Back', 'Shoulders', 'Arms', 'Core', 'Full body', 'Cardio', 'Outdoor', 'Mobility', 'Other'];

export const EQUIPMENT = ['Barbell', 'Dumbbell', 'Kettlebell', 'Machine', 'Cable', 'Smith machine', 'Bodyweight', 'Bench', 'Bands', 'Cardio machine', 'Outdoor / none', 'Other'];

export const MUSCLES = ['Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors', 'Chest', 'Lats', 'Upper back', 'Lower back', 'Traps', 'Front delts', 'Side delts', 'Rear delts', 'Biceps', 'Triceps', 'Forearms', 'Abs', 'Obliques', 'Cardiovascular'];

export const GROUP_TYPES = {
  superset: 'Superset',
  circuit: 'Circuit',
};

export const DEFAULT_SETTINGS = Object.freeze({
  id: 'prefs',
  defaultRestSec: 90,
  weeklyGoal: 3,
  countActivitiesInGoal: true,
  weekStart: 1,
  restSound: true,
  restVibrate: true,
  keepScreenOn: true,
  lastExportAt: null,
  backupEvery: 5,
  effortMode: 'off',
  progressionHints: false,
  barWeightKg: 20,
  platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
  targetBodyWeightKg: null,
  weeklyDistanceGoalKm: null,
  reminderDays: [],
  reminderTime: '17:30',
  measurementTypes: [
    { id: 'bodyweight', label: 'Body weight', unit: 'kg' },
    { id: 'waist', label: 'Waist', unit: 'cm' },
  ],
});

export function withDefaults(settings) {
  const merged = { ...structuredClone(DEFAULT_SETTINGS), ...(settings || {}) };
  if (!Array.isArray(merged.measurementTypes) || merged.measurementTypes.length === 0) {
    merged.measurementTypes = structuredClone(DEFAULT_SETTINGS.measurementTypes);
  }
  if (!Array.isArray(merged.reminderDays)) merged.reminderDays = [];
  if (!Array.isArray(merged.platesKg) || !merged.platesKg.length) merged.platesKg = [...DEFAULT_SETTINGS.platesKg];
  if (!['off', 'rpe', 'rir'].includes(merged.effortMode)) merged.effortMode = 'off';
  return merged;
}

export function fieldsForType(type) {
  return (EXERCISE_TYPES[type] || EXERCISE_TYPES.other).fields;
}

/** Snapshot of the library entry stored inside sessions so history survives renames/deletes. */
export function exerciseSnapshot(ex) {
  if (!ex) return null;
  return {
    name: ex.name,
    type: ex.type,
    category: ex.category || '',
    equipment: ex.equipment || '',
    cardioDisplay: ex.cardioDisplay || null,
    weightMode: ex.weightMode === 'perHand' ? 'perHand' : 'total',
    lowerIsBetter: !!ex.lowerIsBetter,
  };
}

/** "22 kg", "22 kg/hand" or "20 kg assist" depending on how the exercise records weight. */
export function fmtKg(value, snap, fmt = (v) => String(Math.round(v * 100) / 100)) {
  if (!Number.isFinite(value)) return '';
  if (snap?.lowerIsBetter) return `${fmt(value)} kg assist`;
  return `${fmt(value)} kg${snap?.weightMode === 'perHand' ? '/hand' : ''}`;
}

// ---------- per-set and per-session calculations ----------

/**
 * Weight × reps. Per-hand dumbbell weights count both dumbbells. Assisted exercises
 * (lower is better) have no meaningful volume and return 0.
 */
export function setVolumeKg(values, snap = null) {
  if (!values || snap?.lowerIsBetter) return 0;
  const w = values.weightKg;
  const r = values.reps;
  if (!(Number.isFinite(w) && Number.isFinite(r) && w > 0 && r > 0)) return 0;
  return w * r * (snap?.weightMode === 'perHand' ? 2 : 1);
}

/** Estimated one-rep max (Epley). Only meaningful for 1–12 reps; otherwise null. */
export function estimateOneRepMax(weightKg, reps) {
  if (!Number.isFinite(weightKg) || !Number.isFinite(reps) || weightKg <= 0 || reps < 1 || reps > 12) return null;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function paceSecPerKm(durationSec, distanceKm) {
  if (!Number.isFinite(durationSec) || !Number.isFinite(distanceKm) || durationSec <= 0 || distanceKm <= 0) return null;
  return durationSec / distanceKm;
}

export function speedKmh(durationSec, distanceKm) {
  if (!Number.isFinite(durationSec) || !Number.isFinite(distanceKm) || durationSec <= 0 || distanceKm <= 0) return null;
  return distanceKm / (durationSec / 3600);
}

/** Total elapsed active time of a session in seconds (excludes paused time). */
export function sessionElapsedSec(session, now = Date.now()) {
  if (!session || !Number.isFinite(session.startedAt)) return 0;
  if (session.kind === 'activity') return session.activity?.durationSec ?? 0;
  const end = session.status === 'completed' && Number.isFinite(session.endedAt) ? session.endedAt : now;
  let paused = session.pausedMs || 0;
  if (session.pausedAt && session.status !== 'completed') paused += Math.max(0, now - session.pausedAt);
  return Math.max(0, Math.round((end - session.startedAt - paused) / 1000));
}

/** Completed sets that count for statistics (warm-ups excluded). */
export function doneSets(entry) {
  return (entry.sets || []).filter((s) => s.done && s.actual && setKind(s) !== 'warmup');
}

export function doneWarmups(entry) {
  return (entry.sets || []).filter((s) => s.done && setKind(s) === 'warmup');
}

export function sessionSummary(session) {
  const out = { setsDone: 0, setsPlanned: 0, warmupsDone: 0, exercisesDone: 0, exercisesSkipped: 0, volumeKg: 0, reps: 0, distanceKm: 0, durationSec: 0 };
  if (!session) return out;
  if (session.kind === 'activity') {
    out.distanceKm = session.activity?.distanceKm || 0;
    out.durationSec = session.activity?.durationSec || 0;
    return out;
  }
  for (const e of session.entries || []) {
    out.setsPlanned += (e.sets || []).filter((s) => setKind(s) !== 'warmup').length;
    const done = doneSets(e);
    out.setsDone += done.length;
    out.warmupsDone += doneWarmups(e).length;
    if (e.status === 'skipped') out.exercisesSkipped++;
    else if (done.length > 0 || e.status === 'done') out.exercisesDone++;
    for (const s of done) {
      out.volumeKg += setVolumeKg(s.actual, e.exercise);
      out.reps += Number.isFinite(s.actual.reps) ? s.actual.reps : 0;
      out.distanceKm += Number.isFinite(s.actual.distanceKm) ? s.actual.distanceKm : 0;
    }
  }
  out.durationSec = sessionElapsedSec(session);
  return out;
}

export function sessionTitle(session) {
  if (session.kind === 'activity') return session.activity?.exercise?.name || session.name || 'Activity';
  return session.name || session.templateName || 'Workout';
}

// ---------- history per exercise ----------

/**
 * Chronological performance of one exercise (by stable id of the exercise ACTUALLY performed).
 * Includes gym entries and standalone activities. Different exercises are never merged.
 */
export function exerciseHistory(sessions, exerciseId) {
  const rows = [];
  for (const s of sessions) {
    if (s.status !== 'completed') continue;
    if (s.kind === 'activity') {
      const a = s.activity;
      if (a && a.exerciseId === exerciseId) {
        rows.push({
          sessionId: s.id, date: s.startedAt, sets: 1,
          durationSec: a.durationSec ?? null, distanceKm: a.distanceKm ?? null,
          topWeightKg: null, topWeightReps: null, totalReps: 0, volumeKg: 0, bestE1rm: null, maxReps: null,
        });
      }
      continue;
    }
    for (const e of s.entries || []) {
      if (e.exerciseId !== exerciseId) continue;
      const done = doneSets(e);
      if (done.length === 0) continue;
      const lower = !!e.exercise?.lowerIsBetter;
      let topW = null; let topWReps = null; let totalReps = 0; let vol = 0; let best = null; let maxReps = null;
      let dur = 0; let dist = 0; let hasDur = false; let hasDist = false;
      for (const st of done) {
        const a = st.actual;
        // "Top" weight is the heaviest set, or the least assistance for assisted exercises.
        const beats = topW === null || (lower ? a.weightKg < topW : a.weightKg > topW) || (a.weightKg === topW && (a.reps || 0) > (topWReps || 0));
        if (Number.isFinite(a.weightKg) && (lower ? (a.reps || 0) > 0 : a.weightKg > 0) && beats) {
          topW = a.weightKg; topWReps = a.reps ?? null;
        }
        if (Number.isFinite(a.reps)) { totalReps += a.reps; maxReps = Math.max(maxReps ?? 0, a.reps); }
        vol += setVolumeKg(a, e.exercise);
        const e1 = lower ? null : estimateOneRepMax(a.weightKg, a.reps);
        if (e1 !== null && (best === null || e1 > best)) best = e1;
        if (Number.isFinite(a.durationSec)) { dur += a.durationSec; hasDur = true; }
        if (Number.isFinite(a.distanceKm)) { dist += a.distanceKm; hasDist = true; }
      }
      rows.push({
        sessionId: s.id, entryId: e.id, date: s.startedAt, sets: done.length,
        topWeightKg: topW, topWeightReps: topWReps, totalReps, volumeKg: vol, bestE1rm: best, maxReps, lowerIsBetter: lower,
        durationSec: hasDur ? dur : null, distanceKm: hasDist ? dist : null,
      });
    }
  }
  rows.sort((a, b) => a.date - b.date);
  return rows;
}

/** Most recent completed performance of an exercise, for the "last time" hint during a workout. */
export function lastPerformance(sessions, exerciseId, excludeSessionId = null) {
  let best = null;
  for (const s of sessions) {
    if (s.status !== 'completed' || s.id === excludeSessionId) continue;
    if (best && s.startedAt <= best.date) continue;
    if (s.kind === 'activity') {
      if (s.activity?.exerciseId === exerciseId) {
        best = { date: s.startedAt, sessionId: s.id, sets: [{ durationSec: s.activity.durationSec ?? null, distanceKm: s.activity.distanceKm ?? null }] };
      }
      continue;
    }
    for (const e of s.entries || []) {
      if (e.exerciseId !== exerciseId) continue;
      const done = doneSets(e);
      if (done.length) best = { date: s.startedAt, sessionId: s.id, sets: done.map((d) => ({ ...d.actual })) };
    }
  }
  return best;
}

// ---------- personal records ----------

/**
 * Records per exercise id. Values are always per exercise; nothing is compared across exercises.
 * Each record keeps the session it came from so the UI can link to it.
 */
export function computeRecords(sessions) {
  const recs = new Map();
  const get = (id, snap) => {
    if (!recs.has(id)) recs.set(id, { exerciseId: id, name: snap?.name || 'Unknown', type: snap?.type || 'other', cardioDisplay: snap?.cardioDisplay || null });
    const r = recs.get(id);
    if (snap?.name) r.name = snap.name; // newest snapshot wins for display
    return r;
  };
  const better = (r, key, value, date, sessionId, extra = {}, lowerIsBetter = false) => {
    if (value === null || !Number.isFinite(value) || value < 0 || (value === 0 && !lowerIsBetter)) return;
    const cur = r[key];
    if (!cur || (lowerIsBetter ? value < cur.value : value > cur.value)) r[key] = { value, date, sessionId, ...extra };
  };
  const sorted = [...sessions].filter((s) => s.status === 'completed').sort((a, b) => a.startedAt - b.startedAt);
  for (const s of sorted) {
    if (s.kind === 'activity') {
      const a = s.activity;
      if (!a?.exerciseId) continue;
      const r = get(a.exerciseId, a.exercise);
      better(r, 'longestDistanceKm', a.distanceKm, s.startedAt, s.id);
      better(r, 'longestDurationSec', a.durationSec, s.startedAt, s.id);
      if (Number.isFinite(a.distanceKm) && a.distanceKm >= 1) better(r, 'bestPaceSecPerKm', paceSecPerKm(a.durationSec, a.distanceKm), s.startedAt, s.id, { distanceKm: a.distanceKm }, true);
      continue;
    }
    for (const e of s.entries || []) {
      const done = doneSets(e);
      if (!done.length) continue;
      const r = get(e.exerciseId, e.exercise);
      const lower = !!e.exercise?.lowerIsBetter;
      r.weightMode = e.exercise?.weightMode || r.weightMode || 'total';
      r.lowerIsBetter = lower;
      let vol = 0; let dur = 0; let dist = 0;
      for (const st of done) {
        const a = st.actual;
        if (lower) {
          // Assisted: less assistance is better. A record needs at least one rep.
          if ((a.reps || 0) > 0) better(r, 'leastAssistKg', a.weightKg, s.startedAt, s.id, { reps: a.reps }, true);
        } else {
          better(r, 'maxWeightKg', a.weightKg, s.startedAt, s.id, { reps: a.reps ?? null });
          better(r, 'bestE1rmKg', estimateOneRepMax(a.weightKg, a.reps), s.startedAt, s.id, { weightKg: a.weightKg, reps: a.reps });
        }
        better(r, 'maxReps', a.reps, s.startedAt, s.id, { weightKg: a.weightKg ?? null });
        better(r, 'longestSetSec', a.durationSec, s.startedAt, s.id);
        vol += setVolumeKg(a, e.exercise);
        dur += a.durationSec || 0;
        dist += a.distanceKm || 0;
      }
      better(r, 'maxSessionVolumeKg', vol, s.startedAt, s.id);
      if (e.exercise?.type === 'cardio') {
        better(r, 'longestDistanceKm', dist, s.startedAt, s.id);
        better(r, 'longestDurationSec', dur, s.startedAt, s.id);
        if (dist >= 1) better(r, 'bestPaceSecPerKm', paceSecPerKm(dur, dist), s.startedAt, s.id, { distanceKm: dist }, true);
      }
    }
  }
  return recs;
}

export const RECORD_LABELS = {
  maxWeightKg: 'Heaviest set',
  leastAssistKg: 'Least assistance',
  bestE1rmKg: 'Best estimated 1RM',
  maxReps: 'Most reps in a set',
  maxSessionVolumeKg: 'Most volume in a session',
  longestSetSec: 'Longest set',
  longestDistanceKm: 'Longest distance',
  longestDurationSec: 'Longest duration',
  bestPaceSecPerKm: 'Fastest average pace (≥ 1 km)',
};

/** Records set by `session` compared with all sessions completed before it. */
export function newRecordsIn(session, allSessions) {
  const before = allSessions.filter((s) => s.id !== session.id && s.status === 'completed' && s.startedAt < session.startedAt);
  const prev = computeRecords(before);
  const withThis = computeRecords([...before, { ...session, status: 'completed' }]);
  const out = [];
  for (const [id, rec] of withThis) {
    const old = prev.get(id);
    for (const key of Object.keys(RECORD_LABELS)) {
      const nv = rec[key];
      if (!nv || nv.sessionId !== session.id) continue;
      // The very first performance of an exercise is a baseline, not a record.
      if (!old) continue;
      if (!old[key] || nv.value !== old[key].value) out.push({ exerciseId: id, name: rec.name, key, label: RECORD_LABELS[key], value: nv.value, previous: old[key]?.value ?? null, extra: nv, snap: { weightMode: rec.weightMode, lowerIsBetter: rec.lowerIsBetter } });
    }
  }
  return out;
}

// ---------- weekly goal ----------

export function countsTowardGoal(session, settings) {
  if (session.status !== 'completed') return false;
  if (session.kind === 'activity') return settings.countActivitiesInGoal !== false;
  return true;
}

export function weekProgress(sessions, settings, now = Date.now()) {
  const start = startOfWeek(now, settings.weekStart ?? 1);
  const end = addDays(start, 7);
  const inWeek = sessions.filter((s) => s.startedAt >= start && s.startedAt < end && countsTowardGoal(s, settings));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d0 = addDays(start, i);
    const d1 = addDays(start, i + 1);
    days.push({ date: d0, count: inWeek.filter((s) => s.startedAt >= d0 && s.startedAt < d1).length, isToday: now >= d0 && now < d1 });
  }
  const distanceKm = sessions
    .filter((s) => s.status === 'completed' && s.startedAt >= start && s.startedAt < end)
    .reduce((acc, s) => acc + sessionSummary(s).distanceKm, 0);
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
  const goal = Math.max(0, settings.weeklyGoal || 0);
  return { start, end, count: inWeek.length, goal, remaining: Math.max(0, goal - inWeek.length), daysLeft, days, distanceKm };
}

/** Number of consecutive past weeks (including the current one if already met) that met the goal. */
export function goalStreak(sessions, settings, now = Date.now()) {
  if (!settings.weeklyGoal) return 0;
  let streak = 0;
  let cursor = startOfWeek(now, settings.weekStart ?? 1);
  const current = weekProgress(sessions, settings, now);
  if (current.count >= current.goal) streak++;
  for (let i = 0; i < 520; i++) {
    cursor = addDays(cursor, -7);
    const p = weekProgress(sessions, settings, addDays(cursor, 3));
    if (p.count >= p.goal) streak++;
    else break;
  }
  return streak;
}

// ---------- next workout suggestion ----------

/**
 * Suggests the next template: the one following the most recently completed template
 * in the same program (rotation). Falls back to the first template of the first program.
 */
export function suggestNextTemplate(programs, templates, sessions) {
  const activePrograms = programs.filter((p) => !p.archived);
  if (!activePrograms.length) return null;
  const tplByProgram = (pid) => templates.filter((t) => t.programId === pid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const last = [...sessions]
    .filter((s) => s.status === 'completed' && s.kind === 'workout' && s.templateId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .find((s) => templates.some((t) => t.id === s.templateId) && activePrograms.some((p) => p.id === s.programId));
  if (last) {
    const list = tplByProgram(last.programId);
    const idx = list.findIndex((t) => t.id === last.templateId);
    if (list.length) return { template: list[(idx + 1) % list.length], program: activePrograms.find((p) => p.id === last.programId), lastSession: last };
  }
  for (const p of [...activePrograms].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const list = tplByProgram(p.id);
    if (list.length) return { template: list[0], program: p, lastSession: null };
  }
  return null;
}

// ---------- backups ----------

/** Completed sessions recorded since the last export. */
export function sessionsSinceExport(sessions, settings) {
  const since = settings.lastExportAt || 0;
  return sessions.filter((s) => s.status === 'completed' && (s.updatedAt || s.createdAt || s.startedAt) > since).length;
}

/** A backup reminder is due after `backupEvery` new sessions, or 14 days with unsaved sessions. */
export function backupDue(sessions, settings, now = Date.now()) {
  const pending = sessionsSinceExport(sessions, settings);
  if (!pending) return { due: false, pending };
  const every = Math.max(1, settings.backupEvery || 5);
  const stale = !!settings.lastExportAt && now - settings.lastExportAt > 14 * 86400000;
  return { due: pending >= every || stale, pending };
}
