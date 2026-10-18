import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, parseImport, mergeData } from '../../js/backup.js';
import { migrateData } from '../../js/migrations.js';
import { validateData } from '../../js/validate.js';
import { SCHEMA_VERSION, withDefaults } from '../../js/model.js';
import { starterExercises, starterProgram } from '../../js/seed.js';
import * as W from '../../js/workout-logic.js';

const T0 = new Date(2026, 9, 12, 18, 0).getTime();

function sampleData() {
  const exercises = starterExercises(T0);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const { program, templates } = starterProgram(T0);
  const s = W.createSessionFromTemplate(templates[0], program, byId, T0);
  const e = s.entries[0];
  W.setActual(s, e.id, e.sets[0].id, { weightKg: 100, reps: 10 });
  W.completeSet(s, e.id, e.sets[0].id);
  W.finishSession(s, T0 + 3600_000);
  const a = W.createActivitySession({ startedAt: T0, durationSec: 1800, distanceKm: 5 }, byId.get('ex_running'));
  return {
    exercises, programs: [program], templates, sessions: [s, a],
    measurements: [{ id: 'm1', typeId: 'bodyweight', date: T0, value: 80.5, unit: 'kg', note: '' }],
    settings: withDefaults({ weeklyGoal: 4 }),
  };
}

test('export → import round trip preserves everything', () => {
  const data = sampleData();
  const exp = buildExport(data, '1.0.0', T0);
  assert.equal(exp.schemaVersion, SCHEMA_VERSION);
  const res = parseImport(JSON.stringify(exp));
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual(res.data.sessions, data.sessions);
  assert.deepEqual(res.data.exercises, data.exercises);
  assert.equal(res.data.settings.weeklyGoal, 4);
  assert.equal(res.counts.sessions, 2);
});

test('unknown fields are preserved, not discarded', () => {
  const data = sampleData();
  data.exercises[0].myCustomField = { gymSpot: 'Corner rack' };
  const res = parseImport(JSON.stringify(buildExport(data, '1.0.0')));
  assert.equal(res.ok, true);
  assert.deepEqual(res.data.exercises[0].myCustomField, { gymSpot: 'Corner rack' });
});

test('invalid files are rejected with useful messages', () => {
  assert.match(parseImport('{not json').errors[0], /not valid JSON/);
  assert.match(parseImport('[]').errors[0], /does not contain/);
  assert.match(parseImport('{"hello":1}').errors[0], /not a Training Diary export/);
  const exp = buildExport(sampleData(), '1.0.0');
  const future = { ...exp, schemaVersion: SCHEMA_VERSION + 1 };
  assert.match(parseImport(JSON.stringify(future)).errors[0], /newer version/);
  const bad = structuredClone(exp);
  bad.data.sessions[0].entries[0].sets[0].actual.weightKg = 'heavy';
  bad.data.exercises[1].type = 'magic';
  bad.data.exercises[2].id = bad.data.exercises[3].id;
  const r = parseImport(JSON.stringify(bad));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('sessions[0].entries[0].sets[0].actual.weightKg')));
  assert.ok(r.errors.some((e) => e.includes('unknown type "magic"')));
  assert.ok(r.errors.some((e) => e.includes('duplicate id')));
});

test('validation caps the number of errors', () => {
  const data = sampleData();
  data.measurements = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, typeId: 'bodyweight', date: 'x', value: 'y', unit: 'kg' }));
  const { errors } = validateData(data);
  assert.ok(errors.length <= 26);
  assert.match(errors[errors.length - 1], /stopped after/);
});

test('missing collections are treated as empty with a warning', () => {
  const exp = buildExport(sampleData(), '1.0.0');
  delete exp.data.measurements;
  const r = parseImport(JSON.stringify(exp));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.measurements, []);
  assert.ok(r.warnings.some((w) => w.startsWith('measurements')));
});

test('migration runner applies steps in order and refuses gaps', () => {
  const steps = {
    1: (d) => ({ ...d, sessions: d.sessions.map((s) => ({ ...s, v2: true })) }),
    2: (d) => ({ ...d, sessions: d.sessions.map((s) => ({ ...s, v3: s.v2 && true })) }),
  };
  const out = migrateData({ sessions: [{ id: 'a' }] }, 1, 3, steps);
  assert.deepEqual(out.sessions[0], { id: 'a', v2: true, v3: true });
  assert.throws(() => migrateData({ sessions: [] }, 1, 4, steps), /No migration available from data version 3/);
  assert.throws(() => migrateData({}, 5, 3, steps), /newer version/);
  assert.deepEqual(migrateData({ x: 1 }, SCHEMA_VERSION), { x: 1 });
});

test('merge keeps local active workout and local settings', () => {
  const local = sampleData();
  const active = W.createEmptySession(T0 + 10);
  local.sessions.push(active);
  local.settings.weeklyGoal = 2;
  const incoming = sampleData();
  incoming.settings.weeklyGoal = 6;
  const otherActive = W.createEmptySession(T0 + 20);
  incoming.sessions.push(otherActive);
  incoming.sessions[0] = { ...incoming.sessions[0], notes: 'from file' };
  const { data, skippedActive } = mergeData(local, incoming);
  assert.equal(skippedActive, 1);
  assert.ok(data.sessions.some((s) => s.id === active.id));
  assert.ok(!data.sessions.some((s) => s.id === otherActive.id));
  assert.equal(data.sessions.find((s) => s.id === incoming.sessions[0].id).notes, 'from file');
  assert.equal(data.settings.weeklyGoal, 2);
});
