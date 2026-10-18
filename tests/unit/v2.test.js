// Schema v2: set types, per-hand weights, lower-is-better, rep ranges, effort, training aids.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../js/model.js';
import * as W from '../../js/workout-logic.js';
import { migrateData, DATA_MIGRATIONS } from '../../js/migrations.js';
import { platesPerSide, warmupPlan, progressionHint, incrementFor } from '../../js/training-aids.js';
import { starterExercises } from '../../js/seed.js';
import { validateData } from '../../js/validate.js';

const T0 = new Date(2026, 9, 12, 18, 0).getTime();
const DAY = 86400000;
const ex = new Map(starterExercises(T0).map((e) => [e.id, e]));

function workout(at, exerciseId, sets) {
  const s = W.createEmptySession(at);
  const e = W.addEntry(s, ex.get(exerciseId), { sets: 0 });
  for (const v of sets) {
    const st = W.addSet(s, e.id);
    if (v.kind) W.setSetKind(s, e.id, st.id, v.kind);
    W.setActual(s, e.id, st.id, v);
    W.completeSet(s, e.id, st.id);
  }
  W.finishSession(s, at + 3600_000);
  return s;
}

test('warm-up sets are recorded but excluded from stats and records', () => {
  const s = workout(T0, 'ex_back_squat', [
    { kind: 'warmup', weightKg: 20, reps: 10 },
    { kind: 'warmup', weightKg: 60, reps: 5 },
    { weightKg: 100, reps: 5 },
    { kind: 'drop', weightKg: 80, reps: 8 },
  ]);
  const sum = M.sessionSummary(s);
  assert.equal(sum.setsDone, 2, 'working + drop');
  assert.equal(sum.warmupsDone, 2);
  assert.equal(sum.setsPlanned, 2);
  assert.equal(sum.volumeKg, 500 + 640);
  const h = M.exerciseHistory([s], 'ex_back_squat')[0];
  assert.equal(h.sets, 2);
  assert.equal(h.totalReps, 13);
  const rec = M.computeRecords([s]).get('ex_back_squat');
  assert.equal(rec.maxReps.value, 8, 'warm-up 10 reps is not a record');
  const last = M.lastPerformance([s], 'ex_back_squat');
  assert.equal(last.sets.length, 2);
});

test('per-hand dumbbell volume counts both dumbbells', () => {
  assert.equal(ex.get('ex_db_bench_press').weightMode, 'perHand');
  const s = workout(T0, 'ex_db_bench_press', [{ weightKg: 22, reps: 10 }]);
  assert.equal(M.sessionSummary(s).volumeKg, 440);
  assert.equal(M.fmtKg(22, s.entries[0].exercise), '22 kg/hand');
  assert.equal(M.fmtKg(60, { weightMode: 'total' }), '60 kg');
});

test('assisted exercises: less assistance is the record, no volume or 1RM', () => {
  const a = workout(T0, 'ex_assisted_pull_up', [{ weightKg: 30, reps: 8 }]);
  const b = workout(T0 + DAY, 'ex_assisted_pull_up', [{ weightKg: 20, reps: 6 }]);
  const c = workout(T0 + 2 * DAY, 'ex_assisted_pull_up', [{ weightKg: 25, reps: 8 }]);
  const r = M.computeRecords([a, b, c]).get('ex_assisted_pull_up');
  assert.equal(r.leastAssistKg.value, 20);
  assert.equal(r.leastAssistKg.sessionId, b.id);
  assert.equal(r.maxWeightKg, undefined);
  assert.equal(r.bestE1rmKg, undefined);
  assert.equal(M.sessionSummary(a).volumeKg, 0);
  assert.ok(M.newRecordsIn(b, [a, b, c]).some((x) => x.key === 'leastAssistKg'));
  assert.ok(!M.newRecordsIn(c, [a, b, c]).some((x) => x.key === 'leastAssistKg'));
  const hist = M.exerciseHistory([a, b, c], 'ex_assisted_pull_up');
  assert.deepEqual(hist.map((x) => x.topWeightKg), [30, 20, 25]);
  // Unassisted (0 kg) counts as the best possible.
  const d = workout(T0 + 3 * DAY, 'ex_assisted_pull_up', [{ weightKg: 0, reps: 3 }]);
  assert.equal(M.computeRecords([a, b, c, d]).get('ex_assisted_pull_up').leastAssistKg.value, 0);
});

test('migration v1 → v2 sets flags on starter exercises and history snapshots', () => {
  const v1ex = starterExercises(T0).map(({ weightMode, lowerIsBetter, ...rest }) => rest);
  const custom = { id: 'ex_custom', name: 'My machine', type: 'strength', category: 'Other', equipment: 'Machine', builtIn: false };
  const s = workout(T0, 'ex_db_curl', [{ weightKg: 12, reps: 10 }]);
  for (const e of s.entries) { delete e.exercise.weightMode; delete e.exercise.lowerIsBetter; delete e.plannedExercise; }
  const out = migrateData({ exercises: [...v1ex, custom], sessions: [s], programs: [], templates: [], measurements: [] }, 1, 2);
  const byId = new Map(out.exercises.map((e) => [e.id, e]));
  assert.equal(byId.get('ex_db_curl').weightMode, 'perHand');
  assert.equal(byId.get('ex_bench_press').weightMode, 'total');
  assert.equal(byId.get('ex_assisted_pull_up').lowerIsBetter, true);
  assert.equal(byId.get('ex_custom').weightMode, 'total');
  assert.equal(byId.get('ex_custom').lowerIsBetter, false);
  assert.equal(out.sessions[0].entries[0].exercise.weightMode, 'perHand');
  assert.equal(M.sessionSummary(out.sessions[0]).volumeKg, 240);
  assert.equal(validateData(out).errors.length, 0);
  // Values the user already set are not overwritten.
  const keep = DATA_MIGRATIONS[1]({ exercises: [{ ...v1ex.find((e) => e.id === 'ex_db_curl'), weightMode: 'total' }], sessions: [] });
  assert.equal(keep.exercises[0].weightMode, 'total');
});

test('rep ranges are planned, shown and never filled as actual', () => {
  const s = W.createSessionFromTemplate({
    id: 't', name: 'T', items: [{ id: 'i', exerciseId: 'ex_bench_press', sets: 2, reps: 8, repsMax: 12, weightKg: 60 }], groups: [],
  }, null, ex, T0);
  const e = s.entries[0];
  assert.deepEqual(e.sets[0].planned, { weightKg: 60, reps: 8, repsMax: 12 });
  W.completeSet(s, e.id, e.sets[0].id);
  assert.deepEqual(e.sets[0].actual, { weightKg: 60, reps: 8 });
  W.setPlanned(s, e.id, e.sets[1].id, { repsMax: 6 });
  assert.equal(e.sets[1].planned.repsMax, undefined, 'range top below bottom is dropped');
});

test('effort (RPE/RIR) is stored with actual values only', () => {
  const s = W.createEmptySession(T0);
  const e = W.addEntry(s, ex.get('ex_bench_press'), { sets: 1 });
  W.setActual(s, e.id, e.sets[0].id, { weightKg: 60, reps: 5, rpe: 8.5 });
  assert.equal(e.sets[0].actual.rpe, 8.5);
  W.setActual(s, e.id, e.sets[0].id, { rpe: null });
  assert.equal(e.sets[0].actual.rpe, undefined);
  W.setActual(s, e.id, e.sets[0].id, { rir: 2 });
  const added = W.addSet(s, e.id);
  assert.equal(added.planned.rir, undefined, 'effort is not copied into the next plan');
});

test('warm-up sets go before working sets and get a short rest', () => {
  const s = W.createEmptySession(T0);
  const e = W.addEntry(s, ex.get('ex_back_squat'), { sets: 2, restSec: 180 });
  assert.equal(W.addWarmupSets(s, e.id, [{ weightKg: 20, reps: 10 }, { weightKg: 60, reps: 5 }]), 2);
  assert.deepEqual(e.sets.map((x) => M.setKind(x)), ['warmup', 'warmup', 'working', 'working']);
  const next = W.completeSet(s, e.id, e.sets[0].id, 90);
  assert.equal(next.restSec, 60);
  const work = W.completeSet(s, e.id, e.sets[2].id, 90);
  assert.equal(work.restSec, 180);
  const extra = W.addSet(s, e.id);
  assert.equal(M.setKind(extra), 'working');
});

test('plate calculator', () => {
  assert.deepEqual(platesPerSide(100, 20).perSide, [{ plateKg: 25, count: 1 }, { plateKg: 15, count: 1 }]);
  assert.equal(platesPerSide(100, 20).remainderKg, 0);
  const odd = platesPerSide(101, 20);
  assert.equal(odd.loadedKg, 100);
  assert.equal(odd.remainderKg, 1);
  assert.equal(platesPerSide(15, 20).belowBar, true);
  assert.deepEqual(platesPerSide(62.5, 20, [20, 10, 5, 1.25]).perSide, [{ plateKg: 20, count: 1 }, { plateKg: 1.25, count: 1 }]);
});

test('warm-up plan', () => {
  assert.deepEqual(warmupPlan(100, { barbell: true }), [
    { weightKg: 20, reps: 10 }, { weightKg: 40, reps: 8 }, { weightKg: 60, reps: 5 }, { weightKg: 80, reps: 3 },
  ]);
  assert.deepEqual(warmupPlan(20, { barbell: true }), []);
  const light = warmupPlan(30, { stepKg: 2 });
  assert.ok(light.length >= 1 && light.every((x) => x.weightKg < 30));
});

test('progression hint needs a rep range and every set at the top', () => {
  const s = W.createSessionFromTemplate({ id: 't', name: 'T', items: [{ id: 'i', exerciseId: 'ex_bench_press', sets: 3, reps: 8, repsMax: 12, weightKg: 60 }], groups: [] }, null, ex, T0);
  const e = s.entries[0];
  const hit = { sets: [{ weightKg: 60, reps: 12 }, { weightKg: 60, reps: 12 }, { weightKg: 60, reps: 13 }] };
  assert.deepEqual(progressionHint(e, hit, 2.5), { fromKg: 60, toKg: 62.5, topReps: 12, lowerIsBetter: false });
  assert.equal(progressionHint(e, { sets: [{ weightKg: 60, reps: 12 }, { weightKg: 60, reps: 11 }, { weightKg: 60, reps: 12 }] }), null);
  assert.equal(progressionHint(e, { sets: [{ weightKg: 60, reps: 12 }, { weightKg: 62.5, reps: 12 }, { weightKg: 60, reps: 12 }] }), null);
  assert.equal(progressionHint(e, null), null);
  for (const st of e.sets) delete st.planned.repsMax;
  assert.equal(progressionHint(e, hit), null, 'no range, no hint');
  assert.equal(incrementFor(ex.get('ex_db_curl')), 2);
  assert.equal(incrementFor({ incrementKg: 1 }), 1);
});

test('backup reminder after N sessions or 14 days', () => {
  const st = M.withDefaults({ backupEvery: 3, lastExportAt: T0 });
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, status: 'completed', startedAt: T0 + 1000 + i, updatedAt: T0 + 1000 + i }));
  assert.deepEqual(M.backupDue(mk(2), st, T0 + DAY), { due: false, pending: 2 });
  assert.equal(M.backupDue(mk(3), st, T0 + DAY).due, true);
  assert.equal(M.backupDue(mk(1), st, T0 + 15 * DAY).due, true);
  assert.equal(M.backupDue([], st, T0 + 15 * DAY).due, false, 'nothing new, nothing to back up');
  assert.equal(M.backupDue(mk(4), M.withDefaults({ backupEvery: 5 }), T0).due, false);
});
