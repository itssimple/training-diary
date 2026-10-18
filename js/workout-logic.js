// Pure session-manipulation logic for workouts and activities.
// Functions mutate the session object passed in and return useful info; callers persist it.
// Planned values (set.planned) and actual values (set.actual) are always kept separate.

import { uid, clone } from './util.js';
import { exerciseSnapshot, fieldsForType, SET_FIELDS, PLAN_FIELDS, EFFORT_FIELDS, SET_KINDS, setKind } from './model.js';

function plannedFromItem(item, type) {
  const fields = fieldsForType(type);
  const p = {};
  for (const f of SET_FIELDS) {
    if (fields.includes(f) && Number.isFinite(item[f])) p[f] = item[f];
  }
  if (Number.isFinite(p.reps) && Number.isFinite(item.repsMax) && item.repsMax > p.reps) p.repsMax = item.repsMax;
  return p;
}

export function makeSet(planned = null, kind = 'working') {
  const set = { id: uid('set'), planned: planned && Object.keys(planned).length ? { ...planned } : null, actual: null, done: false, doneAt: null, note: '' };
  if (kind !== 'working') set.kind = kind;
  return set;
}

/** Create a session entry for an exercise. */
export function makeEntry(exercise, opts = {}) {
  const snap = exerciseSnapshot(exercise);
  const setCount = Math.max(0, opts.sets ?? 3);
  const planned = opts.planned || {};
  return {
    id: uid('ent'),
    groupId: opts.groupId || null,
    templateItemId: opts.templateItemId || null,
    plannedExerciseId: opts.adHoc ? null : exercise.id,
    plannedExercise: opts.adHoc ? null : snap,
    exerciseId: exercise.id,
    exercise: snap,
    substitution: null,
    adHoc: !!opts.adHoc,
    status: 'pending',
    restSec: Number.isFinite(opts.restSec) ? opts.restSec : null,
    planNotes: opts.planNotes || '',
    notes: '',
    alternativeIds: [...(opts.alternativeIds || [])],
    sets: Array.from({ length: setCount }, () => makeSet(planned)),
  };
}

function baseSession(now) {
  return {
    id: uid('ses'),
    kind: 'workout',
    status: 'active',
    name: 'Workout',
    programId: null,
    programName: null,
    templateId: null,
    templateName: null,
    startedAt: now,
    endedAt: null,
    pausedAt: null,
    pausedMs: 0,
    notes: '',
    groups: [],
    entries: [],
    rest: null,
    focusEntryId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function createEmptySession(now = Date.now()) {
  return baseSession(now);
}

/**
 * Instantiate a workout from a template. Everything is copied, so later template edits
 * never change this session (and vice versa).
 */
export function createSessionFromTemplate(template, program, exercisesById, now = Date.now()) {
  const s = baseSession(now);
  s.name = template.name;
  s.templateId = template.id;
  s.templateName = template.name;
  s.programId = program ? program.id : null;
  s.programName = program ? program.name : null;
  s.planNotes = template.notes || '';
  const groupMap = new Map();
  for (const g of template.groups || []) {
    const ng = { id: uid('grp'), type: g.type, restSec: Number.isFinite(g.restSec) ? g.restSec : null };
    groupMap.set(g.id, ng);
  }
  const usedGroups = new Set();
  for (const item of template.items || []) {
    const ex = exercisesById.get(item.exerciseId) || {
      id: item.exerciseId, name: item.exerciseName || 'Unknown exercise', type: item.exerciseType || 'strength',
    };
    const grp = item.groupId ? groupMap.get(item.groupId) : null;
    if (grp) usedGroups.add(grp.id);
    s.entries.push(makeEntry(ex, {
      sets: item.sets ?? 3,
      planned: plannedFromItem(item, ex.type),
      groupId: grp ? grp.id : null,
      restSec: Number.isFinite(item.restSec) ? item.restSec : (Number.isFinite(ex.defaultRestSec) ? ex.defaultRestSec : null),
      planNotes: item.notes || '',
      alternativeIds: item.alternativeIds || [],
      templateItemId: item.id,
    }));
  }
  s.groups = [...groupMap.values()].filter((g) => usedGroups.has(g.id));
  s.focusEntryId = s.entries[0]?.id || null;
  s.templateSnapshot = clone({ name: template.name, items: template.items || [], groups: template.groups || [] });
  return s;
}

export function createActivitySession(fields, exercise, now = Date.now()) {
  const startedAt = Number.isFinite(fields.startedAt) ? fields.startedAt : now;
  return {
    id: uid('ses'),
    kind: 'activity',
    status: 'completed',
    name: exercise?.name || 'Activity',
    startedAt,
    endedAt: Number.isFinite(fields.durationSec) ? startedAt + fields.durationSec * 1000 : startedAt,
    notes: fields.notes || '',
    activity: {
      exerciseId: exercise?.id || null,
      exercise: exerciseSnapshot(exercise),
      durationSec: fields.durationSec ?? null,
      distanceKm: fields.distanceKm ?? null,
      elevationM: fields.elevationM ?? null,
      calories: fields.calories ?? null,
      avgHr: fields.avgHr ?? null,
      maxHr: fields.maxHr ?? null,
      extra: (fields.extra || []).filter((x) => x && x.label),
    },
    createdAt: now,
    updatedAt: now,
  };
}

// ---------- lookup helpers ----------

export function findEntry(session, entryId) {
  return session.entries.find((e) => e.id === entryId) || null;
}

export function findSet(session, entryId, setId) {
  const e = findEntry(session, entryId);
  return e ? e.sets.find((s) => s.id === setId) || null : null;
}

export function findGroup(session, groupId) {
  return groupId ? (session.groups || []).find((g) => g.id === groupId) || null : null;
}

/** Split entries into display units: single entries or contiguous groups (superset/circuit). */
export function groupUnits(session) {
  const units = [];
  for (const e of session.entries) {
    const last = units[units.length - 1];
    if (e.groupId && last && last.groupId === e.groupId) last.entries.push(e);
    else units.push({ key: e.groupId || e.id, groupId: e.groupId || null, group: findGroup(session, e.groupId), entries: [e] });
  }
  // A "group" of one entry behaves as a single exercise.
  for (const u of units) if (u.entries.length < 2) { u.groupId = null; u.group = null; }
  return units;
}

export function unitForEntry(session, entryId) {
  return groupUnits(session).find((u) => u.entries.some((e) => e.id === entryId)) || null;
}

export function entryProgress(entry) {
  const total = entry.sets.length;
  const done = entry.sets.filter((s) => s.done).length;
  return { done, total };
}

export function isEntryFinished(entry) {
  return entry.status === 'skipped' || entry.status === 'done';
}

function refreshEntryStatus(entry) {
  if (entry.status === 'skipped') return;
  const allDone = entry.sets.length > 0 && entry.sets.every((s) => s.done);
  entry.status = allDone ? 'done' : 'pending';
}

function touch(session, now) {
  session.updatedAt = now;
}

// ---------- set editing ----------

/** Update actual values of a set without completing it (e.g. while typing). */
export function setActual(session, entryId, setId, values, now = Date.now()) {
  const set = findSet(session, entryId, setId);
  if (!set) return null;
  const actual = { ...(set.actual || {}) };
  for (const [k, v] of Object.entries(values)) {
    if (!SET_FIELDS.includes(k) && !EFFORT_FIELDS.includes(k)) continue;
    if (v === null || v === undefined || !Number.isFinite(v)) delete actual[k];
    else actual[k] = v;
  }
  set.actual = Object.keys(actual).length ? actual : null;
  touch(session, now);
  return set;
}

export function setPlanned(session, entryId, setId, values, now = Date.now()) {
  const set = findSet(session, entryId, setId);
  if (!set) return null;
  const planned = { ...(set.planned || {}) };
  for (const [k, v] of Object.entries(values)) {
    if (!PLAN_FIELDS.includes(k)) continue;
    if (v === null || v === undefined || !Number.isFinite(v)) delete planned[k];
    else planned[k] = v;
  }
  if (!(Number.isFinite(planned.repsMax) && Number.isFinite(planned.reps) && planned.repsMax > planned.reps)) delete planned.repsMax;
  set.planned = Object.keys(planned).length ? planned : null;
  touch(session, now);
  return set;
}

export function setSetKind(session, entryId, setId, kind, now = Date.now()) {
  const set = findSet(session, entryId, setId);
  if (!set || !SET_KINDS[kind]) return;
  if (kind === 'working') delete set.kind; else set.kind = kind;
  touch(session, now);
}

/**
 * Insert warm-up sets (e.g. from warmupPlan) before the first working set.
 * Returns the number added.
 */
export function addWarmupSets(session, entryId, plan, now = Date.now()) {
  const entry = findEntry(session, entryId);
  if (!entry || !plan?.length) return 0;
  const idx = entry.sets.findIndex((s) => setKind(s) !== 'warmup');
  const at = idx < 0 ? entry.sets.length : idx;
  entry.sets.splice(at, 0, ...plan.map((p) => makeSet({ weightKg: p.weightKg, reps: p.reps }, 'warmup')));
  if (entry.status === 'done') entry.status = 'pending';
  touch(session, now);
  return plan.length;
}

/**
 * Mark a set done. Missing actual values are filled from the plan (the user accepted the plan as performed).
 * Returns { restSec, nextEntryId } describing what should happen next.
 */
export function completeSet(session, entryId, setId, defaultRestSec = 90, now = Date.now(), suggested = null) {
  const entry = findEntry(session, entryId);
  const set = entry && entry.sets.find((s) => s.id === setId);
  if (!set) return null;
  const fields = fieldsForType(entry.exercise?.type);
  const actual = { ...(set.actual || {}) };
  const fill = suggested || plannedFill(entry, set);
  for (const f of fields) {
    if (!Number.isFinite(actual[f]) && Number.isFinite(fill[f])) actual[f] = fill[f];
  }
  set.actual = Object.keys(actual).length ? actual : null;
  set.done = true;
  set.doneAt = now;
  if (entry.status === 'skipped') entry.status = 'pending';
  refreshEntryStatus(entry);
  touch(session, now);
  return nextAfterSet(session, entry, set, defaultRestSec);
}

function plannedFill(entry, set) {
  const out = {};
  if (!set.planned) return out;
  for (const [k, v] of Object.entries(set.planned)) {
    // A planned weight belongs to the planned exercise; never copy it onto a substitute.
    if (k === 'weightKg' && entry.substitution) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Values shown as placeholders and used when a set is ticked without typing:
 * the plan first, then the previous set of this exercise today, then the same set last time.
 * These are suggestions only; nothing is increased automatically.
 */
export function suggestSetValues(entry, setIndex, lastPerf = null) {
  const set = entry.sets[setIndex];
  const fields = fieldsForType(entry.exercise?.type);
  const plan = set ? plannedFill(entry, set) : {};
  const prev = entry.sets.slice(0, setIndex).reverse().find((s) => s.actual)?.actual || {};
  const last = lastPerf?.sets?.length ? (lastPerf.sets[setIndex] || lastPerf.sets[lastPerf.sets.length - 1]) : {};
  const out = {};
  const source = {};
  for (const f of fields) {
    if (Number.isFinite(plan[f])) { out[f] = plan[f]; source[f] = 'plan'; } else if (Number.isFinite(prev[f])) { out[f] = prev[f]; source[f] = 'previous'; } else if (Number.isFinite(last[f])) { out[f] = last[f]; source[f] = 'last'; }
  }
  return { values: out, source };
}

export function uncompleteSet(session, entryId, setId, now = Date.now()) {
  const entry = findEntry(session, entryId);
  const set = entry && entry.sets.find((s) => s.id === setId);
  if (!set) return;
  set.done = false;
  set.doneAt = null;
  if (entry.status === 'done') entry.status = 'pending';
  refreshEntryStatus(entry);
  touch(session, now);
}

/**
 * Rest/next logic. Single exercise: rest after each set, stay on exercise until done.
 * Superset/circuit: go to the next exercise in the group without rest; rest after the last
 * exercise of a round (using the group rest, or the last exercise's rest).
 */
export function nextAfterSet(session, entry, set, defaultRestSec = 90) {
  const unit = unitForEntry(session, entry.id);
  const baseRest = (e) => (Number.isFinite(e.restSec) ? e.restSec : defaultRestSec);
  // Warm-up sets only need a short break.
  const restOf = (e) => (setKind(set) === 'warmup' ? Math.min(60, baseRest(e)) : baseRest(e));
  if (!unit || !unit.groupId) {
    const finished = entry.sets.every((s) => s.done) || entry.status === 'skipped';
    return { restSec: restOf(entry), nextEntryId: finished ? nextPendingEntryId(session, entry.id) : entry.id, roundComplete: finished };
  }
  const list = unit.entries.filter((e) => e.status !== 'skipped');
  const idx = list.findIndex((e) => e.id === entry.id);
  // Look for the next exercise in this round that still has a pending set.
  for (let i = idx + 1; i < list.length; i++) {
    if (list[i].sets.some((s) => !s.done)) return { restSec: 0, nextEntryId: list[i].id, roundComplete: false };
  }
  const groupRest = Number.isFinite(unit.group?.restSec) ? unit.group.restSec : restOf(list[list.length - 1] || entry);
  const firstPending = list.find((e) => e.sets.some((s) => !s.done));
  if (firstPending) return { restSec: groupRest, nextEntryId: firstPending.id, roundComplete: true };
  return { restSec: groupRest, nextEntryId: nextPendingEntryId(session, entry.id), roundComplete: true };
}

/** Next entry (after `afterEntryId`, wrapping around) that is not finished. */
export function nextPendingEntryId(session, afterEntryId) {
  const list = session.entries;
  const start = list.findIndex((e) => e.id === afterEntryId);
  for (let i = 1; i <= list.length; i++) {
    const e = list[(start + i) % list.length];
    if (!isEntryFinished(e) && e.id !== afterEntryId) return e.id;
  }
  return null;
}

export function addSet(session, entryId, now = Date.now()) {
  const entry = findEntry(session, entryId);
  if (!entry) return null;
  const working = entry.sets.filter((s) => setKind(s) !== 'warmup');
  const last = working[working.length - 1] || entry.sets[entry.sets.length - 1];
  let planned = last ? (last.planned ? { ...last.planned } : (last.actual ? { ...last.actual } : null)) : null;
  if (planned) for (const f of EFFORT_FIELDS) delete planned[f];
  const set = makeSet(planned);
  entry.sets.push(set);
  if (entry.status === 'done') entry.status = 'pending';
  touch(session, now);
  return set;
}

export function removeSet(session, entryId, setId, now = Date.now()) {
  const entry = findEntry(session, entryId);
  if (!entry) return false;
  const before = entry.sets.length;
  entry.sets = entry.sets.filter((s) => s.id !== setId);
  refreshEntryStatus(entry);
  touch(session, now);
  return entry.sets.length < before;
}

export function setSetNote(session, entryId, setId, note, now = Date.now()) {
  const set = findSet(session, entryId, setId);
  if (set) { set.note = String(note || ''); touch(session, now); }
}

// ---------- entry editing ----------

export function skipEntry(session, entryId, now = Date.now()) {
  const e = findEntry(session, entryId);
  if (!e) return;
  e.status = 'skipped';
  touch(session, now);
}

export function unskipEntry(session, entryId, now = Date.now()) {
  const e = findEntry(session, entryId);
  if (!e) return;
  e.status = 'pending';
  refreshEntryStatus(e);
  touch(session, now);
}

/** Mark an exercise complete even if not all sets are ticked (e.g. finished early). */
export function markEntryDone(session, entryId, now = Date.now()) {
  const e = findEntry(session, entryId);
  if (!e) return;
  e.status = 'done';
  touch(session, now);
}

export function reopenEntry(session, entryId, now = Date.now()) {
  const e = findEntry(session, entryId);
  if (!e) return;
  e.status = 'pending';
  touch(session, now);
}

/** Add an exercise to this session only (template is untouched). */
export function addEntry(session, exercise, opts = {}, now = Date.now()) {
  const entry = makeEntry(exercise, { adHoc: true, sets: opts.sets ?? 3, restSec: Number.isFinite(exercise.defaultRestSec) ? exercise.defaultRestSec : null, ...opts });
  if (opts.afterEntryId) {
    const idx = session.entries.findIndex((e) => e.id === opts.afterEntryId);
    session.entries.splice(idx + 1, 0, entry);
  } else {
    session.entries.push(entry);
  }
  touch(session, now);
  return entry;
}

export function removeEntry(session, entryId, now = Date.now()) {
  session.entries = session.entries.filter((e) => e.id !== entryId);
  if (session.focusEntryId === entryId) session.focusEntryId = session.entries[0]?.id || null;
  if (session.rest && session.rest.entryId === entryId) session.rest.entryId = null;
  pruneGroups(session);
  touch(session, now);
}

/**
 * Substitute the performed exercise (e.g. machine occupied).
 * - No sets done yet: the entry switches exercise; the plan and planned exercise are kept.
 * - Some sets done: the entry is closed with the done sets, and a new entry with the remaining
 *   planned sets is inserted for the substitute. History therefore never attributes sets of
 *   one exercise to another.
 * Returns the entry that now represents the substitute.
 */
export function substituteEntry(session, entryId, newExercise, note = '', now = Date.now()) {
  const entry = findEntry(session, entryId);
  if (!entry || !newExercise) return null;
  const snap = exerciseSnapshot(newExercise);
  const sub = {
    fromExerciseId: entry.exerciseId,
    fromName: entry.exercise?.name || '',
    note: String(note || ''),
    at: now,
  };
  const doneCount = entry.sets.filter((s) => s.done).length;
  if (doneCount === 0) {
    entry.exerciseId = newExercise.id;
    entry.exercise = snap;
    entry.substitution = entry.substitution
      ? { ...sub, fromExerciseId: entry.substitution.fromExerciseId, fromName: entry.substitution.fromName }
      : sub;
    // If we swapped back to the planned exercise, it is no longer a substitution.
    if (entry.plannedExerciseId && entry.plannedExerciseId === newExercise.id) entry.substitution = null;
    // Plans are kept as the historical prescription; typed actual values belonged to the old exercise.
    for (const s of entry.sets) s.actual = null;
    if (entry.status === 'skipped') entry.status = 'pending';
    touch(session, now);
    return entry;
  }
  const remaining = entry.sets.filter((s) => !s.done);
  entry.sets = entry.sets.filter((s) => s.done);
  entry.status = 'done';
  const repl = {
    ...clone(entry),
    id: uid('ent'),
    exerciseId: newExercise.id,
    exercise: snap,
    substitution: { ...sub, fromEntryId: entry.id },
    status: 'pending',
    notes: '',
    sets: (remaining.length ? remaining : [makeSet(entry.sets[entry.sets.length - 1]?.planned)]).map((s) => makeSet(s.planned)),
  };
  const idx = session.entries.findIndex((e) => e.id === entry.id);
  session.entries.splice(idx + 1, 0, repl);
  touch(session, now);
  return repl;
}

/** Move an entry. Grouped entries move within their group; others move past whole units. */
export function moveEntry(session, entryId, dir, now = Date.now()) {
  const list = session.entries;
  const idx = list.findIndex((e) => e.id === entryId);
  if (idx < 0) return false;
  const entry = list[idx];
  const unit = unitForEntry(session, entryId);
  if (unit && unit.groupId) {
    const j = idx + dir;
    if (j < 0 || j >= list.length || list[j].groupId !== entry.groupId) return false;
    [list[idx], list[j]] = [list[j], list[idx]];
    touch(session, now);
    return true;
  }
  return moveUnit(session, entry.id, dir, now);
}

/** Move a whole unit (single entry or full group) up/down past the neighbouring unit. */
export function moveUnit(session, anyEntryId, dir, now = Date.now()) {
  const units = groupUnits(session);
  const i = units.findIndex((u) => u.entries.some((e) => e.id === anyEntryId));
  const j = i + dir;
  if (i < 0 || j < 0 || j >= units.length) return false;
  [units[i], units[j]] = [units[j], units[i]];
  session.entries = units.flatMap((u) => u.entries);
  touch(session, now);
  return true;
}

/** Link an entry with the next unit into a superset/circuit (session-only change). */
export function linkWithNext(session, entryId, type = 'superset', now = Date.now()) {
  const units = groupUnits(session);
  const i = units.findIndex((u) => u.entries.some((e) => e.id === entryId));
  if (i < 0 || i + 1 >= units.length) return null;
  const a = units[i];
  const b = units[i + 1];
  let gid = a.groupId || b.groupId;
  if (!gid) {
    gid = uid('grp');
    session.groups.push({ id: gid, type, restSec: null });
  } else if (!findGroup(session, gid)) {
    session.groups.push({ id: gid, type, restSec: null });
  }
  for (const e of [...a.entries, ...b.entries]) e.groupId = gid;
  pruneGroups(session);
  touch(session, now);
  return gid;
}

export function unlinkEntry(session, entryId, now = Date.now()) {
  const e = findEntry(session, entryId);
  if (!e || !e.groupId) return;
  const gid = e.groupId;
  const members = session.entries.filter((x) => x.groupId === gid);
  // Removing a middle member would split the group in two; detach it and move it after the group.
  e.groupId = null;
  const idx = session.entries.indexOf(e);
  const lastIdx = session.entries.map((x) => x.groupId).lastIndexOf(gid);
  if (members.length > 2 && lastIdx > idx) {
    session.entries.splice(idx, 1);
    session.entries.splice(lastIdx, 0, e);
  }
  pruneGroups(session);
  touch(session, now);
}

export function pruneGroups(session) {
  const counts = new Map();
  for (const e of session.entries) if (e.groupId) counts.set(e.groupId, (counts.get(e.groupId) || 0) + 1);
  for (const e of session.entries) if (e.groupId && counts.get(e.groupId) < 2) e.groupId = null;
  session.groups = (session.groups || []).filter((g) => (counts.get(g.id) || 0) >= 2);
}

// ---------- session lifecycle ----------

export function pauseSession(session, now = Date.now()) {
  if (session.pausedAt || session.status !== 'active') return;
  session.pausedAt = now;
  if (session.rest && !session.rest.pausedRemainingMs && session.rest.endsAt) {
    session.rest.pausedRemainingMs = Math.max(0, session.rest.endsAt - now);
  }
  touch(session, now);
}

export function resumeSession(session, now = Date.now()) {
  if (!session.pausedAt) return;
  session.pausedMs = (session.pausedMs || 0) + Math.max(0, now - session.pausedAt);
  session.pausedAt = null;
  if (session.rest && Number.isFinite(session.rest.pausedRemainingMs)) {
    session.rest.endsAt = now + session.rest.pausedRemainingMs;
    session.rest.pausedRemainingMs = null;
  }
  touch(session, now);
}

export function finishSession(session, now = Date.now()) {
  if (session.pausedAt) resumeSession(session, now);
  session.status = 'completed';
  session.endedAt = now;
  session.rest = null;
  touch(session, now);
}

// ---------- rest timer (timestamp-based, survives backgrounding and reloads) ----------

export function startRest(session, durationSec, entryId = null, now = Date.now()) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) { session.rest = null; return null; }
  session.rest = { entryId, durationSec, startedAt: now, endsAt: now + durationSec * 1000, pausedRemainingMs: null, alerted: false };
  touch(session, now);
  return session.rest;
}

export function restRemainingMs(rest, now = Date.now()) {
  if (!rest) return 0;
  if (Number.isFinite(rest.pausedRemainingMs)) return rest.pausedRemainingMs;
  return Math.max(0, rest.endsAt - now);
}

export function pauseRest(session, now = Date.now()) {
  const r = session.rest;
  if (!r || Number.isFinite(r.pausedRemainingMs)) return;
  r.pausedRemainingMs = Math.max(0, r.endsAt - now);
  touch(session, now);
}

export function resumeRest(session, now = Date.now()) {
  const r = session.rest;
  if (!r || !Number.isFinite(r.pausedRemainingMs)) return;
  r.endsAt = now + r.pausedRemainingMs;
  r.pausedRemainingMs = null;
  touch(session, now);
}

export function adjustRest(session, deltaSec, now = Date.now()) {
  const r = session.rest;
  if (!r) return;
  if (Number.isFinite(r.pausedRemainingMs)) r.pausedRemainingMs = Math.max(0, r.pausedRemainingMs + deltaSec * 1000);
  else r.endsAt = Math.max(now, r.endsAt + deltaSec * 1000);
  r.durationSec = Math.max(0, r.durationSec + deltaSec);
  r.alerted = false;
  touch(session, now);
}

export function resetRest(session, now = Date.now()) {
  const r = session.rest;
  if (!r) return;
  r.endsAt = now + r.durationSec * 1000;
  r.pausedRemainingMs = Number.isFinite(r.pausedRemainingMs) ? r.durationSec * 1000 : null;
  r.alerted = false;
  touch(session, now);
}

export function clearRest(session, now = Date.now()) {
  session.rest = null;
  touch(session, now);
}

// ---------- quick log (enter results after the workout) ----------

/**
 * Default row for the quick log: the template's plan (sets/reps/time/distance) and
 * last time's values as suggestions. Weight is taken from the plan, else last time's top set.
 */
export function quickRowDefaults(exercise, item = null, lastPerf = null) {
  const fields = fieldsForType(exercise.type);
  const lastSets = lastPerf?.sets || [];
  const lastTop = lastSets.reduce((best, s) => (Number.isFinite(s.weightKg) && (best === null || (exercise.lowerIsBetter ? s.weightKg < best : s.weightKg > best)) ? s.weightKg : best), null);
  const pick = (f) => {
    if (item && Number.isFinite(item[f])) return item[f];
    if (f === 'weightKg') return lastTop;
    const v = lastSets.find((s) => Number.isFinite(s[f]))?.[f];
    return Number.isFinite(v) ? v : null;
  };
  const sets = item && Number.isFinite(item.sets) && item.sets > 0 ? item.sets : (lastSets.length || (exercise.type === 'cardio' ? 1 : 3));
  const row = { exerciseId: exercise.id, templateItemId: item?.id || null, sets, skipped: false };
  for (const f of fields) row[f] = pick(f);
  if (fields.includes('reps') && !Number.isFinite(row.reps)) row.reps = 10;
  if (item && Number.isFinite(item.repsMax)) row.repsMax = item.repsMax;
  return row;
}

/**
 * Build a completed workout from quick-log rows. Each row becomes `sets` identical done sets.
 * When a template is given, its plan is kept as the plan, so history still shows planned vs done.
 * rows: [{ exerciseId, templateItemId?, sets, weightKg?, reps?, durationSec?, distanceKm?, skipped? }]
 */
export function buildQuickSession({ template = null, program = null, exercisesById, rows, startedAt, durationMin = null, notes = '', now = Date.now() }) {
  const s = template ? createSessionFromTemplate(template, program, exercisesById, startedAt) : createEmptySession(startedAt);
  if (!template) s.name = 'Workout';
  const byItem = new Map(s.entries.map((e) => [e.templateItemId, e]));
  const entries = [];
  for (const row of rows) {
    const ex = exercisesById.get(row.exerciseId);
    if (!ex) continue;
    let entry = row.templateItemId ? byItem.get(row.templateItemId) : null;
    if (entry && entry.exerciseId !== ex.id) {
      // Swapped in the quick log: keep the template's plan, record the substitute.
      entry.substitution = { fromExerciseId: entry.exerciseId, fromName: entry.exercise?.name || '', note: '', at: now };
      entry.exerciseId = ex.id;
      entry.exercise = exerciseSnapshot(ex);
    }
    if (!entry) entry = makeEntry(ex, { adHoc: !!template, sets: 0 });
    if (row.skipped) {
      entry.status = 'skipped';
      for (const st of entry.sets) { st.actual = null; st.done = false; }
      entries.push(entry);
      continue;
    }
    const fields = fieldsForType(ex.type);
    const actual = {};
    for (const f of fields) if (Number.isFinite(row[f])) actual[f] = row[f];
    const n = Math.max(1, Math.min(50, Math.round(row.sets || 1)));
    const plans = entry.sets.filter((x) => setKind(x) !== 'warmup').map((x) => x.planned);
    entry.sets = Array.from({ length: n }, (_, i) => {
      const st = makeSet(plans[i] ?? plans[plans.length - 1] ?? null);
      st.actual = Object.keys(actual).length ? { ...actual } : null;
      st.done = true;
      st.doneAt = startedAt;
      return st;
    });
    entry.status = 'done';
    entries.push(entry);
  }
  // Template exercises not in the rows at all count as skipped (still visible in history).
  for (const e of s.entries) if (!entries.includes(e)) { e.status = 'skipped'; entries.push(e); }
  s.entries = entries;
  pruneGroups(s);
  s.status = 'completed';
  s.endedAt = startedAt + Math.max(0, Math.round(durationMin || 0)) * 60000;
  s.notes = notes || '';
  s.quickLog = true;
  s.focusEntryId = null;
  s.createdAt = now;
  s.updatedAt = now;
  return s;
}
