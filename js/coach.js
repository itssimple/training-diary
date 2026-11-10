// AI coach round trip, independent of any particular LLM:
//  1. buildCoachExport(): a self-describing JSON file with library, programs, templates and history.
//  2. coachPrompt(): instructions that explain the file and the exact answer format.
//  3. extractPlan() + reviewPlan(): read the LLM's answer and validate every proposed change.
//  4. applyPlan(): produce new exercises/programs/templates. History is never touched.
// Pure functions (no DOM/DB) so they are unit-tested.

import {
  EXERCISE_TYPES, CATEGORIES, EQUIPMENT, MUSCLES, GROUP_TYPES, WEIGHT_MODES, SET_KINDS,
  exerciseHistory, sessionSummary, setKind,
} from './model.js';
import { uid, isoDate, isoDateTimeLocal, startOfWeek, addDays } from './util.js';

export const COACH_EXPORT_FORMAT = 'training-diary-coach-export';
export const PLAN_FORMAT = 'training-diary-plan';
export const COACH_VERSION = 1;

const clean = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  return out;
};
const pick = (obj, keys) => (obj ? clean(Object.fromEntries(keys.map((k) => [k, obj[k]]))) : null);
const SET_VALUE_KEYS = ['weightKg', 'reps', 'repsMax', 'durationSec', 'distanceKm', 'rpe', 'rir'];

// ---------- export ----------

function exportExercise(e) {
  return clean({
    id: e.id, name: e.name, type: e.type, category: e.category, equipment: e.equipment,
    muscles: e.muscles, primaryMuscles: e.primaryMuscles,
    weightMode: e.weightMode === 'perHand' ? 'perHand' : undefined, lowerIsBetter: e.lowerIsBetter || undefined,
    alternativeIds: e.alternativeIds, archived: e.archived || undefined,
    defaultRestSec: e.defaultRestSec, incrementKg: e.incrementKg,
    description: e.description, instructions: e.instructions, cues: e.cues, commonMistakes: e.commonMistakes,
    personalNotes: e.notes,
  });
}

function exportTemplate(t) {
  return clean({
    id: t.id, programId: t.programId, name: t.name, notes: t.notes, order: t.order,
    items: (t.items || []).map((it) => clean({
      exerciseId: it.exerciseId, exerciseName: it.exerciseName, sets: it.sets, reps: it.reps, repsMax: it.repsMax,
      weightKg: it.weightKg, durationSec: it.durationSec, distanceKm: it.distanceKm, restSec: it.restSec,
      notes: it.notes, alternativeIds: it.alternativeIds, groupId: it.groupId,
    })),
    groups: (t.groups || []).map((g) => clean({ id: g.id, type: g.type, restSec: g.restSec })),
  });
}

function exportSession(s) {
  const date = isoDateTimeLocal(s.startedAt);
  if (s.kind === 'activity') {
    const a = s.activity || {};
    return clean({
      date, kind: 'activity', exerciseId: a.exerciseId, name: a.exercise?.name,
      durationSec: a.durationSec, distanceKm: a.distanceKm, elevationM: a.elevationM, calories: a.calories,
      avgHr: a.avgHr, maxHr: a.maxHr, notes: s.notes,
    });
  }
  const sum = sessionSummary(s);
  return clean({
    date, kind: 'workout', name: s.name, templateId: s.templateId, durationMin: sum.durationSec ? Math.round(sum.durationSec / 60) : null,
    loggedAfterTraining: s.quickLog || s.loggedAfterwards || s.imported ? true : undefined,
    notes: s.notes,
    exercises: (s.entries || []).map((e) => clean({
      exerciseId: e.exerciseId, name: e.exercise?.name,
      status: e.status === 'skipped' ? 'skipped' : e.sets.some((x) => x.done) ? 'done' : 'not performed',
      substitutedFor: e.substitution ? (e.plannedExerciseId || e.substitution.fromExerciseId) : undefined,
      substitutionNote: e.substitution?.note,
      notes: e.notes,
      sets: e.sets.map((st) => clean({
        kind: setKind(st) === 'working' ? undefined : setKind(st),
        planned: pick(st.planned, SET_VALUE_KEYS),
        actual: st.done ? pick(st.actual, SET_VALUE_KEYS) : undefined,
        done: st.done,
        note: st.note,
      })),
    })),
  });
}

/**
 * opts: { weeks (number|'all'), includeBody, goals, appVersion, now, exportId }
 */
export function buildCoachExport(data, opts = {}) {
  const now = opts.now ?? Date.now();
  const weeks = opts.weeks === 'all' ? null : Number(opts.weeks || 12);
  const from = weeks ? startOfWeek(addDays(now, -7 * weeks), data.settings?.weekStart ?? 1) : 0;
  const completed = (data.sessions || []).filter((s) => s.status === 'completed').sort((a, b) => a.startedAt - b.startedAt);
  const inWindow = completed.filter((s) => s.startedAt >= from);
  const exById = new Map((data.exercises || []).map((e) => [e.id, e]));

  // Per-exercise trends over ALL history, so a short window still shows long-term progress.
  const ids = [...new Set(completed.flatMap((s) => (s.kind === 'activity' ? [s.activity?.exerciseId] : (s.entries || []).map((e) => e.exerciseId))).filter(Boolean))];
  const perExercise = ids.map((id) => {
    const rows = exerciseHistory(completed, id);
    if (!rows.length) return null;
    const ex = exById.get(id);
    const lower = !!rows[rows.length - 1].lowerIsBetter;
    const tops = rows.map((r) => r.topWeightKg).filter(Number.isFinite);
    const last = rows[rows.length - 1];
    return clean({
      exerciseId: id, name: ex?.name,
      sessionsTotal: rows.length, sessionsInWindow: rows.filter((r) => r.date >= from).length,
      firstDate: isoDate(rows[0].date), lastDate: isoDate(last.date),
      bestTopWeightKg: tops.length ? (lower ? Math.min(...tops) : Math.max(...tops)) : undefined,
      bestEstimated1RmKg: rows.some((r) => r.bestE1rm) ? Math.round(Math.max(...rows.map((r) => r.bestE1rm || 0)) * 10) / 10 : undefined,
      recentTopWeightsKg: tops.length ? rows.slice(-6).map((r) => r.topWeightKg ?? null) : undefined,
      recentTotalReps: rows.slice(-6).map((r) => r.totalReps || 0).some(Boolean) ? rows.slice(-6).map((r) => r.totalReps || 0) : undefined,
      recentDistanceKm: rows.some((r) => r.distanceKm) ? rows.slice(-6).map((r) => r.distanceKm ?? null) : undefined,
      lowerIsBetter: lower || undefined,
    });
  }).filter(Boolean);

  const weekly = [];
  if (inWindow.length) {
    const ws = data.settings?.weekStart ?? 1;
    for (let w = startOfWeek(weeks ? from : inWindow[0].startedAt, ws); w <= now; w = addDays(w, 7)) {
      const list = inWindow.filter((s) => s.startedAt >= w && s.startedAt < addDays(w, 7));
      const sums = list.map(sessionSummary);
      weekly.push({
        weekStart: isoDate(w),
        workouts: list.filter((s) => s.kind === 'workout').length,
        activities: list.filter((s) => s.kind === 'activity').length,
        workingSets: sums.reduce((a, x) => a + x.setsDone, 0),
        volumeKg: Math.round(sums.reduce((a, x) => a + x.volumeKg, 0)),
      });
    }
  }

  const st = data.settings || {};
  const out = {
    format: COACH_EXPORT_FORMAT,
    version: COACH_VERSION,
    exportId: opts.exportId || uid('exp'),
    exportedAt: new Date(now).toISOString(),
    app: { name: 'Training Diary', version: opts.appVersion || '' },
    units: { weight: 'kg', distance: 'km', durations: 'seconds (durationSec, restSec)', dates: 'local time, YYYY-MM-DDTHH:mm' },
    athlete: clean({
      goals: (opts.goals || '').trim() || undefined,
      weeklyGoalSessions: st.weeklyGoal, weekStartsOn: st.weekStart === 0 ? 'Sunday' : 'Monday',
      defaultRestSec: st.defaultRestSec, effortTracking: st.effortMode && st.effortMode !== 'off' ? st.effortMode.toUpperCase() : undefined,
      barbellKg: st.barWeightKg, availablePlatesKg: st.platesKg,
    }),
    historyWindow: { from: weeks ? isoDate(from) : (completed[0] ? isoDate(completed[0].startedAt) : null), to: isoDate(now), weeks: weeks || 'all' },
    allowedValues: {
      exerciseTypes: Object.fromEntries(Object.entries(EXERCISE_TYPES).map(([k, v]) => [k, v.label])),
      categories: CATEGORIES, equipment: EQUIPMENT, muscles: MUSCLES.filter((m) => m !== 'Cardiovascular').concat('Cardiovascular'),
      groupTypes: Object.keys(GROUP_TYPES), weightModes: Object.keys(WEIGHT_MODES), setKinds: Object.keys(SET_KINDS),
    },
    exercises: (data.exercises || []).map(exportExercise),
    programs: (data.programs || []).map((p) => clean({ id: p.id, name: p.name, description: p.description, archived: p.archived || undefined })),
    templates: (data.templates || []).map(exportTemplate),
    summary: { perExercise, weekly },
    history: inWindow.map(exportSession),
  };
  if (opts.includeBody) {
    const types = new Map((st.measurementTypes || []).map((t) => [t.id, t.label]));
    out.bodyMeasurements = clean({
      targetBodyWeightKg: st.targetBodyWeightKg,
      entries: (data.measurements || []).filter((m) => m.date >= from).sort((a, b) => a.date - b.date)
        .map((m) => ({ date: isoDate(m.date), measurement: types.get(m.typeId) || m.typeId, value: m.value, unit: m.unit })),
    });
  }
  return out;
}

export function coachFileName(exp) {
  return `training-diary-coach-${exp.exportedAt.slice(0, 10)}.json`;
}

// ---------- prompt ----------

const EXAMPLE_PLAN = {
  format: PLAN_FORMAT,
  version: COACH_VERSION,
  basedOnExportId: '<exportId from the data>',
  summary: 'Two-sentence overview of what changes and why.',
  exercises: {
    add: [{
      tempId: 'new:cable-row-wide', name: 'Wide-grip cable row', type: 'strength', category: 'Back', equipment: 'Cable',
      muscles: ['Upper back', 'Rear delts', 'Lats'], primaryMuscles: ['Upper back'], weightMode: 'total', lowerIsBetter: false,
      defaultRestSec: 90, description: 'One sentence.',
      instructions: 'Step one.\nStep two.\nStep three.', cues: 'Cue one\nCue two', commonMistakes: 'Mistake one\nMistake two',
      alternativeIds: ['<existing exercise id>'], reason: 'Why this exercise is added.',
    }],
    update: [{ id: '<existing exercise id>', changes: { defaultRestSec: 120, cues: 'Improved cue\nAnother cue' }, reason: 'Why.' }],
    archive: [{ id: '<existing exercise id>', reason: 'Why it should no longer be used.' }],
  },
  programs: {
    add: [{ tempId: 'new:upper-lower', name: 'Upper / Lower', description: 'Optional.', reason: 'Why.' }],
    update: [{ id: '<existing program id>', changes: { name: 'New name' }, reason: 'Why.' }],
    archive: [{ id: '<existing program id>', reason: 'Why.' }],
  },
  templates: {
    add: [{
      tempId: 'new:upper-a', programId: 'new:upper-lower', name: 'Upper A', notes: 'Optional.',
      items: [
        { exerciseId: '<existing exercise id>', sets: 3, reps: 6, repsMax: 8, weightKg: 62.5, restSec: 150 },
        { exerciseId: 'new:cable-row-wide', sets: 3, reps: 10, repsMax: 12, groupId: 'g1' },
        { exerciseId: '<existing exercise id>', sets: 3, reps: 12, groupId: 'g1' },
      ],
      groups: [{ id: 'g1', type: 'superset', restSec: 90 }],
      reason: 'Why.',
    }],
    update: [{ id: '<existing template id>', changes: { items: ['<complete new items list, same shape as above>'] }, reason: 'Why.' }],
    remove: [{ id: '<existing template id>', reason: 'Why.' }],
  },
};

/**
 * The prompt text. embedData: include the JSON in the prompt (single paste) instead of
 * referring to an attached file.
 */
export function coachPrompt(exp, { embedData = false, fileName = coachFileName(exp) } = {}) {
  const goals = exp.athlete?.goals ? exp.athlete.goals : 'Not written down. Assume general strength, muscle and health with my current weekly frequency, and ask me about my goals at the end.';
  const dataRef = embedData ? 'the JSON data at the end of this message' : `the attached file "${fileName}"`;
  return `You are an experienced, evidence-based strength and conditioning coach. I log my training in an offline workout diary app. ${embedData ? 'At the end of this message' : 'Attached'} is a JSON export (format "${COACH_EXPORT_FORMAT}", version ${COACH_VERSION}) with my exercise library, my training programs and workout templates (my planned workouts), and my recorded training history for ${exp.historyWindow.weeks === 'all' ? 'all time' : `the last ${exp.historyWindow.weeks} weeks`} (${exp.historyWindow.from} to ${exp.historyWindow.to}).

## My goals
${goals}

## How to read ${dataRef}
- Units: weights in kg, distances in km, all durations in seconds (durationSec, restSec). Dates are local time.
- "exercises": my exercise library. "type" decides what is recorded per set: ${Object.entries(EXERCISE_TYPES).map(([k, v]) => `${k} = ${v.label}`).join('; ')}.
  - weightMode "perHand": the weight is ONE dumbbell, used in each hand. Volume counts both.
  - lowerIsBetter true: assisted machines, where the weight is assistance. LOWER is progress.
  - personalNotes are my own notes (machine settings etc.).
- "programs" contain "templates" (my planned workouts, linked by programId). Template "items" are in the order I do them: sets, reps (or a range reps–repsMax), planned weightKg, durationSec/distanceKm for timed or cardio work, restSec. Items with the same "groupId" form a superset or circuit defined in "groups".
- "history": completed sessions, oldest first. Each exercise lists its sets with "planned" (what the template said) and "actual" (what I really did). done=false means the set was not performed. kind "warmup" sets are warm-ups and must not count as work; "drop" and "failure" are working sets. status "skipped" means I skipped the exercise; "substitutedFor" means I swapped exercises (e.g. machine busy). loggedAfterTraining=true means I entered the results after the session, so planned and actual may be identical by default.
- "summary.perExercise": precomputed trends over all my history (recentTopWeightsKg are the last sessions' heaviest working sets, oldest first). "summary.weekly": sessions, working sets and volume per week.
${exp.bodyMeasurements ? '- "bodyMeasurements": my body measurements (for context only; do not make health claims).\n' : ''}- Treat the history as facts. Do not assume anything that is not in the data; if something important is missing, say so.

## What I want from you
1. A short analysis: progression and stalls per exercise, training frequency and consistency, weekly volume per muscle group and balance (push/pull/legs/core), exercises I often skip or swap, and whether my templates fit my goals and the time I actually spend.
2. At most 10 concrete, prioritised suggestions, each with the reason from my data.
3. If changes to my exercises, programs or templates would help, output them as exactly ONE JSON code block in the format below, as the last thing in your answer. Only include changes you actually recommend. If nothing should change, say so and output no JSON.

## Rules for the JSON
- History can never be changed. Never include history, sessions, sets I did, measurements or settings; the app ignores them.
- Refer to existing things by their exact "id" from the data. Never invent ids for existing things.
- New exercises, programs and templates get a "tempId" starting with "new:" (for example "new:upper-a"). Use that tempId to refer to them elsewhere in the same JSON.
- Prefer exercises that already exist in my library. Only add a new exercise if it is clearly needed, and then give it complete info: type, category, equipment, muscles and primaryMuscles, a one-sentence description, instructions (one step per line, separated by \\n), cues and commonMistakes (one per line).
- Allowed values (anything else is rejected): exercise types ${Object.keys(EXERCISE_TYPES).join(', ')}; categories ${CATEGORIES.join(', ')}; equipment ${EQUIPMENT.join(', ')}; muscles ${MUSCLES.join(', ')}; group types ${Object.keys(GROUP_TYPES).join(', ')}; weightMode ${Object.keys(WEIGHT_MODES).join(', ')}.
- Exercise "update" may change: name, type, category, equipment, muscles, primaryMuscles, weightMode, lowerIsBetter, defaultRestSec, incrementKg, description, instructions, cues, commonMistakes, alternativeIds. Only list the fields that change, inside "changes".
- "archive" hides an exercise or program but keeps it in my history. A template "remove" deletes the planned workout only; my history keeps it.
- Template "add" needs a programId (an existing program id or a "new:" program tempId). A template "update" with "items" REPLACES the whole items list, so always send the complete new list in order (inside "changes"), plus a "groups" list if any item uses groupId.
- Template items: exerciseId (required), sets (1–20), reps (1–100), repsMax (optional, greater than reps, for a range), weightKg, durationSec, distanceKm, restSec, notes, groupId. Base planned weights on my recent actual performance. Leave weightKg out for exercises I have never done.
- Never include URLs or video links.
- Every change needs a short "reason".
- Valid JSON only: double quotes, no comments, no trailing commas.

## Answer format
Start with the analysis and suggestions in plain text. Then the JSON code block, shaped like this example (leave out any section you don't need; empty arrays are fine):

\`\`\`json
${JSON.stringify(EXAMPLE_PLAN, null, 2)}
\`\`\`

I will import that JSON into the app, review each change and choose which ones to apply.${embedData ? `

## My data (${COACH_EXPORT_FORMAT})

\`\`\`json
${JSON.stringify(exp)}
\`\`\`` : ''}
`;
}

// ---------- reading the answer ----------

/** Find the plan JSON in an LLM answer: fenced code blocks (last valid one wins) or raw JSON. */
export function extractPlan(text) {
  const src = String(text || '').trim();
  if (!src) return { ok: false, error: 'The answer is empty. Paste the whole reply from the AI, including the JSON block.' };
  const candidates = [];
  for (const m of src.matchAll(/```(?:json|JSON)?\s*\n?([\s\S]*?)```/g)) candidates.push(m[1]);
  if (!candidates.length) {
    const first = src.indexOf('{');
    const last = src.lastIndexOf('}');
    if (first >= 0 && last > first) candidates.push(src.slice(first, last + 1));
  }
  let lastErr = null;
  for (const c of candidates.reverse()) {
    try {
      const obj = JSON.parse(c.trim());
      if (obj && typeof obj === 'object' && obj.format === PLAN_FORMAT) return { ok: true, plan: obj };
      if (obj && typeof obj === 'object' && obj.format === COACH_EXPORT_FORMAT) lastErr = 'This is the data export, not the AI\'s answer. Paste the reply you got back from the AI.';
      else lastErr = lastErr || `Found JSON, but it is not a "${PLAN_FORMAT}" answer (format field missing or different).`;
    } catch (e) {
      lastErr = lastErr || `The JSON in the answer is not valid (${e.message}). Ask the AI to "output only valid JSON in the required format".`;
    }
  }
  return { ok: false, error: lastErr || 'No JSON block found in the answer. If the AI only gave advice, there is nothing to import.' };
}

// ---------- review ----------

const MAX_TEXT = { name: 80, description: 500, instructions: 3000, cues: 1500, commonMistakes: 1500, notes: 500 };
const EX_FIELDS = ['name', 'type', 'category', 'equipment', 'muscles', 'primaryMuscles', 'weightMode', 'lowerIsBetter', 'defaultRestSec', 'incrementKg', 'description', 'instructions', 'cues', 'commonMistakes', 'alternativeIds', 'cardioDisplay', 'isActivity'];
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isTemp = (id) => typeof id === 'string' && id.startsWith('new:');

function textValue(v, max) {
  if (Array.isArray(v)) v = v.map((x) => String(x)).join('\n');
  if (v === null || v === undefined) return '';
  return String(v).replace(/\r\n/g, '\n').slice(0, max).trim();
}

function numIn(v, min, max) {
  if (v === null || v === undefined || v === '') return { value: null };
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) return { error: true };
  return { value: n };
}

function changeFields(entry) {
  // Accept both { id, changes: {...} } and fields directly on the entry.
  if (entry && typeof entry.changes === 'object' && entry.changes) return entry.changes;
  const rest = { ...entry };
  for (const k of ['id', 'tempId', 'reason']) delete rest[k];
  return rest;
}

/**
 * Validate an LLM plan against current data.
 * Returns { ok, errors, warnings, summary, changes: [{ key, entity, op, ref, title, reason, before, after, problems, notes, deps }] }.
 * ctx: { lastExport: { id, at } }
 */
export function reviewPlan(plan, data, ctx = {}) {
  const errors = [];
  const warnings = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return { ok: false, errors: ['The answer is not a JSON object.'], warnings, changes: [] };
  if (plan.format !== PLAN_FORMAT) errors.push(`"format" must be "${PLAN_FORMAT}".`);
  if (Number(plan.version) > COACH_VERSION) errors.push(`This answer uses format version ${plan.version}; this app understands version ${COACH_VERSION}. Update the app.`);
  if (errors.length) return { ok: false, errors, warnings, changes: [] };

  for (const k of ['history', 'sessions', 'measurements', 'bodyMeasurements', 'settings', 'sets']) {
    if (k in plan) warnings.push(`"${k}" was ignored: past training and settings can never be changed by an import.`);
  }
  for (const k of Object.keys(plan)) {
    if (!['format', 'version', 'basedOnExportId', 'summary', 'exercises', 'programs', 'templates', 'history', 'sessions', 'measurements', 'bodyMeasurements', 'settings', 'sets'].includes(k)) warnings.push(`Unknown section "${k}" was ignored.`);
  }
  if (ctx.lastExport?.id && plan.basedOnExportId && plan.basedOnExportId !== ctx.lastExport.id) {
    warnings.push('This answer was made from an older export than your latest one. Check the changes carefully.');
  }

  const exercises = data.exercises || [];
  const programs = data.programs || [];
  const templates = data.templates || [];
  const exById = new Map(exercises.map((e) => [e.id, e]));
  const prById = new Map(programs.map((p) => [p.id, p]));
  const tpById = new Map(templates.map((t) => [t.id, t]));
  const changedSince = (rec) => ctx.lastExport?.at && rec?.updatedAt && rec.updatedAt > ctx.lastExport.at;
  const changes = [];
  const tempExercise = new Map(); // tempId -> change
  const tempProgram = new Map();
  let n = 0;
  const mk = (entity, op, entry) => ({ key: `${entity}-${op}-${n++}`, entity, op, ref: entry?.id || entry?.tempId || null, title: '', reason: textValue(entry?.reason, 500), before: null, after: null, problems: [], notes: [], deps: [] });
  const section = (obj, name) => {
    if (obj === undefined || obj === null) return {};
    if (typeof obj !== 'object' || Array.isArray(obj)) { warnings.push(`"${name}" must be an object with add/update/... lists; it was ignored.`); return {}; }
    return obj;
  };
  const list = (sec, op, name) => {
    const v = sec[op];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { warnings.push(`"${name}.${op}" must be a list; it was ignored.`); return []; }
    return v.filter((x) => x && typeof x === 'object');
  };

  // Resolve an exercise reference (existing id or tempId) for templates/alternatives.
  const resolveEx = (id, change, where) => {
    if (exById.has(id)) {
      if (exById.get(id).archived) change.notes.push(`${where}: "${exById.get(id).name}" is archived in your library.`);
      return { id, name: exById.get(id).name, type: exById.get(id).type };
    }
    if (isTemp(id) && tempExercise.has(id)) {
      const c = tempExercise.get(id);
      change.deps.push(c.key);
      return { id, name: c.after?.name || id, type: c.after?.type || 'strength' };
    }
    change.problems.push(`${where}: exercise "${id}" does not exist in your library or in this answer.`);
    return null;
  };

  function sanitizeExercise(fields, change, { isAdd, selfId }) {
    const out = {};
    for (const k of Object.keys(fields)) {
      if (k === 'notes' || k === 'personalNotes') { change.notes.push('Personal notes are yours; the AI cannot change them (ignored).'); continue; }
      if (/url|video|link|image/i.test(k)) { change.notes.push(`"${k}" ignored: links and media are not imported.`); continue; }
      if (!EX_FIELDS.includes(k) && !['id', 'tempId', 'reason', 'changes'].includes(k)) change.notes.push(`Unknown field "${k}" ignored.`);
    }
    if ('name' in fields || isAdd) {
      const name = textValue(fields.name, MAX_TEXT.name);
      if (!name) change.problems.push('A name is required.');
      else {
        const dup = exercises.find((e) => e.id !== selfId && norm(e.name) === norm(name));
        if (dup) change.problems.push(`An exercise called "${dup.name}" already exists${dup.archived ? ' (archived)' : ''} (id ${dup.id}). The AI should update that one instead.`);
        const dupAdd = [...tempExercise.values()].find((c) => c !== change && norm(c.after?.name) === norm(name));
        if (dupAdd) change.problems.push(`"${name}" is added twice in this answer.`);
        out.name = name;
      }
    }
    if ('type' in fields || isAdd) {
      if (!(fields.type in EXERCISE_TYPES)) change.problems.push(`Unknown type "${fields.type ?? ''}". Allowed: ${Object.keys(EXERCISE_TYPES).join(', ')}.`);
      else out.type = fields.type;
    }
    if ('category' in fields || isAdd) {
      if (CATEGORIES.includes(fields.category)) out.category = fields.category;
      else { out.category = 'Other'; if (fields.category) change.notes.push(`Unknown category "${fields.category}", using "Other".`); }
    }
    if ('equipment' in fields || isAdd) {
      if (EQUIPMENT.includes(fields.equipment)) out.equipment = fields.equipment;
      else { out.equipment = 'Other'; if (fields.equipment) change.notes.push(`Unknown equipment "${fields.equipment}", using "Other".`); }
    }
    for (const k of ['muscles', 'primaryMuscles']) {
      if (!(k in fields)) continue;
      const arr = Array.isArray(fields[k]) ? fields[k] : [];
      const bad = arr.filter((m) => !MUSCLES.includes(m));
      if (bad.length) change.notes.push(`Unknown muscle names ignored: ${bad.join(', ')}.`);
      out[k] = [...new Set(arr.filter((m) => MUSCLES.includes(m)))];
    }
    if (out.primaryMuscles && out.muscles) out.muscles = [...new Set([...out.primaryMuscles, ...out.muscles])];
    if ('weightMode' in fields) {
      if (fields.weightMode in WEIGHT_MODES) out.weightMode = fields.weightMode;
      else change.notes.push(`Unknown weightMode "${fields.weightMode}" ignored.`);
    }
    for (const k of ['lowerIsBetter', 'isActivity']) {
      if (!(k in fields)) continue;
      if (typeof fields[k] === 'boolean') out[k] = fields[k];
      else change.notes.push(`"${k}" must be true or false (ignored).`);
    }
    if ('defaultRestSec' in fields) {
      const r = numIn(fields.defaultRestSec, 0, 1800);
      if (r.error) change.notes.push('defaultRestSec must be 0–1800 seconds (ignored).'); else out.defaultRestSec = r.value === null ? null : Math.round(r.value);
    }
    if ('incrementKg' in fields) {
      const r = numIn(fields.incrementKg, 0.25, 50);
      if (r.error) change.notes.push('incrementKg must be 0.25–50 kg (ignored).'); else out.incrementKg = r.value;
    }
    if ('cardioDisplay' in fields && ['pace', 'speed'].includes(fields.cardioDisplay)) out.cardioDisplay = fields.cardioDisplay;
    for (const k of ['description', 'instructions', 'cues', 'commonMistakes']) if (k in fields) out[k] = textValue(fields[k], MAX_TEXT[k]);
    if ('alternativeIds' in fields) {
      const arr = Array.isArray(fields.alternativeIds) ? fields.alternativeIds : [];
      out.alternativeIds = [];
      for (const a of arr) {
        if (a === selfId) continue;
        if (exById.has(a)) out.alternativeIds.push(a);
        else if (isTemp(a)) out.alternativeIds.push(a); // resolved after all adds are known
        else change.notes.push(`Alternative "${a}" does not exist (ignored).`);
      }
    }
    if (isAdd && !out.muscles) out.muscles = out.primaryMuscles || [];
    return out;
  }

  const exSec = section(plan.exercises, 'exercises');
  const prSec = section(plan.programs, 'programs');
  const tpSec = section(plan.templates, 'templates');

  // Exercises: adds first so tempIds are known.
  for (const e of list(exSec, 'add', 'exercises')) {
    const c = mk('exercise', 'add', e);
    if (!isTemp(e.tempId)) { c.notes.push('No "new:" tempId given; one was assigned.'); e.tempId = `new:auto-${n}`; }
    if (tempExercise.has(e.tempId)) c.problems.push(`tempId "${e.tempId}" is used twice.`);
    c.ref = e.tempId;
    tempExercise.set(e.tempId, c);
    c.after = sanitizeExercise(e, c, { isAdd: true, selfId: null });
    c.title = c.after.name || e.tempId;
    changes.push(c);
  }
  for (const c of changes.filter((x) => x.entity === 'exercise')) {
    c.after.alternativeIds = (c.after.alternativeIds || []).filter((a) => {
      if (!isTemp(a)) return true;
      if (tempExercise.has(a) && a !== c.ref) { c.deps.push(tempExercise.get(a).key); return true; }
      c.notes.push(`Alternative "${a}" is not defined in this answer (ignored).`);
      return false;
    });
  }
  for (const e of list(exSec, 'update', 'exercises')) {
    const c = mk('exercise', 'update', e);
    const cur = exById.get(e.id);
    if (!cur) { c.problems.push(`Exercise "${e.id}" does not exist.`); c.title = String(e.id || '?'); changes.push(c); continue; }
    c.before = cur;
    c.title = cur.name;
    const fields = changeFields(e);
    const patch = sanitizeExercise(fields, c, { isAdd: false, selfId: cur.id });
    for (const a of patch.alternativeIds || []) if (isTemp(a)) { if (tempExercise.has(a)) c.deps.push(tempExercise.get(a).key); }
    if (!Object.keys(patch).length) c.problems.push('Nothing to change.');
    c.after = { ...cur, ...patch };
    c.patch = patch;
    if (changedSince(cur)) c.notes.push('You changed this exercise in the app after the export.');
    changes.push(c);
  }
  for (const op of ['archive', 'remove']) {
    for (const e of list(exSec, op, 'exercises')) {
      const c = mk('exercise', 'archive', e);
      const cur = exById.get(e.id);
      if (!cur) { c.problems.push(`Exercise "${e.id}" does not exist.`); c.title = String(e.id || '?'); changes.push(c); continue; }
      if (op === 'remove') c.notes.push('Exercises are archived, not deleted, so your history keeps them.');
      if (cur.archived) c.problems.push('Already archived.');
      c.before = cur;
      c.after = { ...cur, archived: true };
      c.title = cur.name;
      changes.push(c);
    }
  }

  // Programs.
  for (const p of list(prSec, 'add', 'programs')) {
    const c = mk('program', 'add', p);
    if (!isTemp(p.tempId)) { c.notes.push('No "new:" tempId given; one was assigned.'); p.tempId = `new:auto-${n}`; }
    c.ref = p.tempId;
    const name = textValue(p.name, MAX_TEXT.name);
    if (!name) c.problems.push('A name is required.');
    c.after = { name, description: textValue(p.description, 1000) };
    c.title = name || p.tempId;
    tempProgram.set(p.tempId, c);
    changes.push(c);
  }
  for (const p of list(prSec, 'update', 'programs')) {
    const c = mk('program', 'update', p);
    const cur = prById.get(p.id);
    if (!cur) { c.problems.push(`Program "${p.id}" does not exist.`); c.title = String(p.id || '?'); changes.push(c); continue; }
    const f = changeFields(p);
    const patch = {};
    if ('name' in f) { const nm = textValue(f.name, MAX_TEXT.name); if (nm) patch.name = nm; else c.problems.push('Name cannot be empty.'); }
    if ('description' in f) patch.description = textValue(f.description, 1000);
    if (!Object.keys(patch).length && !c.problems.length) c.problems.push('Nothing to change.');
    c.before = cur; c.after = { ...cur, ...patch }; c.patch = patch; c.title = cur.name;
    changes.push(c);
  }
  for (const op of ['archive', 'remove']) {
    for (const p of list(prSec, op, 'programs')) {
      const c = mk('program', 'archive', p);
      const cur = prById.get(p.id);
      if (!cur) { c.problems.push(`Program "${p.id}" does not exist.`); c.title = String(p.id || '?'); changes.push(c); continue; }
      if (op === 'remove') c.notes.push('Programs are archived, not deleted; their workouts stay available under "Archived programs".');
      c.before = cur; c.after = { ...cur, archived: true }; c.title = cur.name;
      changes.push(c);
    }
  }

  // Templates.
  function sanitizeItems(items, groups, c) {
    if (!Array.isArray(items)) { c.problems.push('"items" must be a list.'); return { items: [], groups: [] }; }
    if (!items.length) c.problems.push('A workout needs at least one exercise.');
    if (items.length > 40) c.problems.push('More than 40 exercises in one workout.');
    const gIn = Array.isArray(groups) ? groups : [];
    const gOut = [];
    for (const g of gIn) {
      if (!g || typeof g !== 'object' || !g.id) { c.notes.push('A group without id was ignored.'); continue; }
      if (!(g.type in GROUP_TYPES)) { c.notes.push(`Group "${g.id}" has unknown type "${g.type}"; using superset.`); }
      const r = numIn(g.restSec, 0, 1800);
      gOut.push({ id: String(g.id), type: g.type in GROUP_TYPES ? g.type : 'superset', restSec: r.error ? null : r.value });
    }
    const gIds = new Set(gOut.map((g) => g.id));
    const out = [];
    items.forEach((it, i) => {
      const where = `Exercise ${i + 1}`;
      if (!it || typeof it !== 'object') { c.problems.push(`${where} is not an object.`); return; }
      const ex = resolveEx(it.exerciseId, c, where);
      if (!ex) return;
      const item = { exerciseId: ex.id, exerciseName: ex.name, exerciseType: ex.type };
      const sets = numIn(it.sets ?? 3, 1, 20);
      if (sets.error) c.problems.push(`${where} (${ex.name}): sets must be 1–20.`); else item.sets = Math.round(sets.value ?? 3);
      for (const [k, min, max, int] of [['reps', 1, 100, true], ['weightKg', 0, 500], ['durationSec', 0, 36000, true], ['distanceKm', 0, 500], ['restSec', 0, 1800, true]]) {
        const r = numIn(it[k], min, max);
        if (r.error) c.problems.push(`${where} (${ex.name}): ${k} must be ${min}–${max}.`);
        else item[k] = r.value === null ? null : (int ? Math.round(r.value) : r.value);
      }
      if (it.repsMax !== undefined && it.repsMax !== null) {
        const r = numIn(it.repsMax, 1, 100);
        if (r.error || !Number.isFinite(item.reps) || r.value <= item.reps) c.notes.push(`${where} (${ex.name}): repsMax ignored (must be more than reps).`);
        else item.repsMax = Math.round(r.value);
      }
      item.notes = textValue(it.notes, MAX_TEXT.notes);
      item.alternativeIds = (Array.isArray(it.alternativeIds) ? it.alternativeIds : []).filter((a) => {
        if (exById.has(a)) return true;
        if (isTemp(a) && tempExercise.has(a)) { c.deps.push(tempExercise.get(a).key); return true; }
        c.notes.push(`${where}: alternative "${a}" ignored (unknown).`);
        return false;
      });
      if (it.groupId !== undefined && it.groupId !== null) {
        if (gIds.has(String(it.groupId))) item.groupId = String(it.groupId);
        else c.notes.push(`${where}: group "${it.groupId}" is not defined (ignored).`);
      }
      out.push(item);
    });
    // Groups need at least two contiguous members.
    for (const g of gOut) {
      const idx = out.map((x, i) => (x.groupId === g.id ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 2 || idx[idx.length - 1] - idx[0] !== idx.length - 1) {
        c.notes.push(`Group "${g.id}" needs two or more exercises next to each other; it was dropped.`);
        for (const x of out) if (x.groupId === g.id) delete x.groupId;
      }
    }
    const used = new Set(out.map((x) => x.groupId).filter(Boolean));
    return { items: out, groups: gOut.filter((g) => used.has(g.id)) };
  }
  const resolveProgram = (pid, c) => {
    if (prById.has(pid)) return pid;
    if (isTemp(pid) && tempProgram.has(pid)) { c.deps.push(tempProgram.get(pid).key); return pid; }
    c.problems.push(pid ? `Program "${pid}" does not exist.` : 'A programId is required (an existing program or a "new:" program).');
    return null;
  };
  for (const t of list(tpSec, 'add', 'templates')) {
    const c = mk('template', 'add', t);
    c.ref = isTemp(t.tempId) ? t.tempId : `new:auto-${n}`;
    const name = textValue(t.name, MAX_TEXT.name);
    if (!name) c.problems.push('A name is required.');
    const programId = resolveProgram(t.programId, c);
    const { items, groups } = sanitizeItems(t.items, t.groups, c);
    c.after = { name, notes: textValue(t.notes, 2000), programId, items, groups };
    c.title = name || c.ref;
    changes.push(c);
  }
  for (const t of list(tpSec, 'update', 'templates')) {
    const c = mk('template', 'update', t);
    const cur = tpById.get(t.id);
    if (!cur) { c.problems.push(`Workout template "${t.id}" does not exist.`); c.title = String(t.id || '?'); changes.push(c); continue; }
    const f = changeFields(t);
    const patch = {};
    if ('name' in f) { const nm = textValue(f.name, MAX_TEXT.name); if (nm) patch.name = nm; else c.problems.push('Name cannot be empty.'); }
    if ('notes' in f) patch.notes = textValue(f.notes, 2000);
    if ('programId' in f) { const pid = resolveProgram(f.programId, c); if (pid) patch.programId = pid; }
    if ('items' in f) Object.assign(patch, sanitizeItems(f.items, f.groups ?? cur.groups, c));
    else if ('groups' in f) c.notes.push('Groups can only change together with the items list (ignored).');
    if (!Object.keys(patch).length && !c.problems.length) c.problems.push('Nothing to change.');
    c.before = cur; c.after = { ...cur, ...patch }; c.patch = patch; c.title = cur.name;
    if (changedSince(cur)) c.notes.push('You changed this workout in the app after the export.');
    changes.push(c);
  }
  for (const t of list(tpSec, 'remove', 'templates')) {
    const c = mk('template', 'remove', t);
    const cur = tpById.get(t.id);
    if (!cur) { c.problems.push(`Workout template "${t.id}" does not exist.`); c.title = String(t.id || '?'); changes.push(c); continue; }
    c.before = cur; c.title = cur.name;
    c.notes.push('Only the planned workout is deleted; recorded workouts stay in your history.');
    changes.push(c);
  }

  // Archiving an exercise still used by a template that stays: warn.
  for (const c of changes.filter((x) => x.entity === 'exercise' && x.op === 'archive' && x.before)) {
    const users = templates.filter((t) => {
      const upd = changes.find((u) => u.entity === 'template' && u.ref === t.id && (u.op === 'remove' || (u.op === 'update' && u.patch?.items)));
      if (upd?.op === 'remove') return false;
      const items = upd ? upd.patch.items : t.items || [];
      return items.some((i) => i.exerciseId === c.before.id);
    });
    if (users.length) c.notes.push(`Still used in: ${users.map((t) => t.name).join(', ')}.`);
  }

  // A change is only valid when all its dependencies are valid.
  const byKey = new Map(changes.map((c) => [c.key, c]));
  let again = true;
  while (again) {
    again = false;
    for (const c of changes) {
      c.deps = [...new Set(c.deps)];
      const broken = c.deps.map((k) => byKey.get(k)).filter((d) => d && d.problems.length);
      for (const d of broken) {
        const msg = `Needs "${d.title}", which can't be applied.`;
        if (!c.problems.includes(msg)) { c.problems.push(msg); again = true; }
      }
    }
  }
  for (const c of changes) c.valid = c.problems.length === 0;
  if (!changes.length) warnings.push('The answer contains no changes.');
  return { ok: true, errors, warnings, summary: textValue(plan.summary, 2000), changes };
}

/** Keys of all changes `key` depends on, recursively. */
export function dependenciesOf(changes, key) {
  const byKey = new Map(changes.map((c) => [c.key, c]));
  const out = new Set();
  const walk = (k) => { for (const d of byKey.get(k)?.deps || []) if (!out.has(d)) { out.add(d); walk(d); } };
  walk(key);
  return out;
}

/** Keys of all changes that depend on `key`, recursively. */
export function dependentsOf(changes, key) {
  return new Set(changes.filter((c) => dependenciesOf(changes, c.key).has(key)).map((c) => c.key));
}

// ---------- apply ----------

/**
 * Apply the selected valid changes. Returns { exercises, programs, templates, applied, skipped }.
 * Dependencies are enforced: a change whose dependency is not applied is skipped.
 */
export function applyPlan(data, review, selectedKeys, now = Date.now()) {
  const selected = new Set(selectedKeys);
  const changes = review.changes.filter((c) => c.valid && selected.has(c.key));
  const ok = new Set();
  const skipped = [];
  for (const c of changes) {
    const deps = dependenciesOf(review.changes, c.key);
    if ([...deps].every((d) => selected.has(d) && review.changes.find((x) => x.key === d)?.valid)) ok.add(c.key);
    else skipped.push(c.key);
  }
  const exercises = (data.exercises || []).map((e) => ({ ...e }));
  const programs = (data.programs || []).map((p) => ({ ...p }));
  let templates = (data.templates || []).map((t) => ({ ...t }));
  const idMap = new Map();
  const real = (id) => idMap.get(id) || id;
  const run = changes.filter((c) => ok.has(c.key));

  // 1. New ids for every add.
  for (const c of run) {
    if (c.op !== 'add') continue;
    idMap.set(c.ref, c.entity === 'exercise' ? uid('ex') : c.entity === 'program' ? uid('prg') : uid('tpl'));
  }
  // 2. Exercises.
  for (const c of run.filter((x) => x.entity === 'exercise')) {
    if (c.op === 'add') {
      exercises.push({
        description: '', category: 'Other', equipment: 'Other', muscles: [], primaryMuscles: [], instructions: '', cues: '', commonMistakes: '',
        notes: '', defaultRestSec: null, cardioDisplay: c.after.type === 'cardio' ? 'pace' : null, isActivity: false, archived: false, meta: [],
        weightMode: 'total', lowerIsBetter: false, builtIn: false,
        ...c.after,
        alternativeIds: (c.after.alternativeIds || []).map(real),
        id: real(c.ref), createdAt: now, updatedAt: now, addedByCoachAt: now,
      });
    } else {
      const i = exercises.findIndex((e) => e.id === c.before.id);
      if (i < 0) continue;
      const patch = c.op === 'archive' ? { archived: true } : { ...c.patch, ...(c.patch.alternativeIds ? { alternativeIds: c.patch.alternativeIds.map(real) } : {}) };
      exercises[i] = { ...exercises[i], ...patch, updatedAt: now, editedByCoachAt: now };
    }
  }
  // 3. Programs.
  for (const c of run.filter((x) => x.entity === 'program')) {
    if (c.op === 'add') {
      programs.push({ id: real(c.ref), name: c.after.name, description: c.after.description, order: programs.length, archived: false, createdAt: now, updatedAt: now });
    } else {
      const i = programs.findIndex((p) => p.id === c.before.id);
      if (i >= 0) programs[i] = { ...programs[i], ...(c.op === 'archive' ? { archived: true } : c.patch), updatedAt: now };
    }
  }
  // 4. Templates.
  const buildItems = (items, groups) => {
    const gMap = new Map((groups || []).map((g) => [g.id, uid('grp')]));
    return {
      items: items.map((it) => ({
        id: uid('it'), exerciseId: real(it.exerciseId), exerciseName: it.exerciseName, exerciseType: it.exerciseType,
        groupId: it.groupId ? gMap.get(it.groupId) : null, sets: it.sets, reps: it.reps ?? null, repsMax: it.repsMax ?? null,
        weightKg: it.weightKg ?? null, durationSec: it.durationSec ?? null, distanceKm: it.distanceKm ?? null, restSec: it.restSec ?? null,
        notes: it.notes || '', alternativeIds: (it.alternativeIds || []).map(real),
      })),
      groups: (groups || []).map((g) => ({ id: gMap.get(g.id), type: g.type, restSec: g.restSec ?? null })),
    };
  };
  for (const c of run.filter((x) => x.entity === 'template')) {
    if (c.op === 'add') {
      const programId = real(c.after.programId);
      templates.push({
        id: real(c.ref), programId, name: c.after.name, notes: c.after.notes || '',
        order: templates.filter((t) => t.programId === programId).length,
        ...buildItems(c.after.items, c.after.groups), createdAt: now, updatedAt: now,
      });
    } else if (c.op === 'remove') {
      templates = templates.filter((t) => t.id !== c.before.id);
    } else {
      const i = templates.findIndex((t) => t.id === c.before.id);
      if (i < 0) continue;
      const patch = { ...c.patch };
      if (patch.programId) patch.programId = real(patch.programId);
      if (patch.items) Object.assign(patch, buildItems(patch.items, patch.groups));
      templates[i] = { ...templates[i], ...patch, updatedAt: now };
    }
  }
  return { exercises, programs, templates, applied: [...ok], skipped };
}

/** Human-readable before/after lines for a template's items. */
export function describeItems(items, exName = (id) => id) {
  return (items || []).map((it) => {
    const parts = [];
    if (it.sets) parts.push(`${it.sets} ×`);
    if (Number.isFinite(it.reps)) parts.push(Number.isFinite(it.repsMax) ? `${it.reps}–${it.repsMax}` : `${it.reps}`);
    if (Number.isFinite(it.weightKg)) parts.push(`@ ${it.weightKg} kg`);
    if (Number.isFinite(it.durationSec)) parts.push(`${it.durationSec} s`);
    if (Number.isFinite(it.distanceKm)) parts.push(`${it.distanceKm} km`);
    return { exerciseId: it.exerciseId, group: it.groupId || null, text: `${it.exerciseName || exName(it.exerciseId)}: ${parts.join(' ') || 'no plan'}` };
  });
}
