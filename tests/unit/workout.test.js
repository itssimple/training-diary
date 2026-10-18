import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../../js/workout-logic.js';
import { starterExercises, starterProgram } from '../../js/seed.js';
import { sessionSummary, sessionElapsedSec } from '../../js/model.js';

const T0 = new Date(2026, 9, 12, 17, 0).getTime();
const exercises = starterExercises(T0);
const byId = new Map(exercises.map((e) => [e.id, e]));
const { program, templates } = starterProgram(T0);
const tplA = templates[0];

function fresh() {
  return W.createSessionFromTemplate(structuredClone(tplA), program, byId, T0);
}

test('session from template copies plan and is independent of the template', () => {
  const tpl = structuredClone(tplA);
  tpl.items[0].weightKg = 100;
  const s = W.createSessionFromTemplate(tpl, program, byId, T0);
  assert.equal(s.entries.length, tpl.items.length);
  assert.equal(s.entries[0].sets.length, 3);
  assert.deepEqual(s.entries[0].sets[0].planned, { weightKg: 100, reps: 10 });
  assert.equal(s.entries[0].sets[0].actual, null);
  assert.equal(s.entries[0].exercise.name, 'Leg press');
  // Editing the template afterwards does not change the session.
  tpl.items[0].weightKg = 120;
  tpl.items[0].sets = 5;
  byId.get('ex_leg_press').name = 'Renamed';
  assert.equal(s.entries[0].sets[0].planned.weightKg, 100);
  assert.equal(s.entries[0].sets.length, 3);
  assert.equal(s.entries[0].exercise.name, 'Leg press');
  byId.get('ex_leg_press').name = 'Leg press';
  // Superset group carried over with a new id.
  assert.equal(s.groups.length, 1);
  const grouped = s.entries.filter((e) => e.groupId);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].groupId, s.groups[0].id);
  assert.notEqual(s.groups[0].id, tplA.groups[0].id);
});

test('timed exercise only gets relevant planned fields', () => {
  const s = fresh();
  const plank = s.entries.find((e) => e.exerciseId === 'ex_plank');
  assert.deepEqual(plank.sets[0].planned, { durationSec: 40 });
});

test('completing a set fills missing actual values from the plan, keeps typed ones', () => {
  const s = fresh();
  const e = s.entries[0];
  W.setPlanned(s, e.id, e.sets[0].id, { weightKg: 80 });
  W.setActual(s, e.id, e.sets[0].id, { reps: 8 });
  const next = W.completeSet(s, e.id, e.sets[0].id, 90, T0 + 1000);
  assert.deepEqual(e.sets[0].actual, { reps: 8, weightKg: 80 });
  assert.equal(e.sets[0].planned.reps, 10, 'plan untouched');
  assert.equal(e.sets[0].done, true);
  assert.equal(next.restSec, 120, 'item rest override');
  assert.equal(next.nextEntryId, e.id, 'stay on exercise until done');
});

test('finishing all sets marks exercise done and moves on', () => {
  const s = fresh();
  const e = s.entries[0];
  let next;
  for (const st of e.sets) next = W.completeSet(s, e.id, st.id, 90);
  assert.equal(e.status, 'done');
  assert.equal(next.nextEntryId, s.entries[1].id);
  W.uncompleteSet(s, e.id, e.sets[2].id);
  assert.equal(e.status, 'pending');
});

test('superset alternates without rest, rests after the round', () => {
  const s = fresh();
  const [a, b] = s.entries.filter((e) => e.groupId);
  const r1 = W.completeSet(s, a.id, a.sets[0].id, 90);
  assert.equal(r1.restSec, 0);
  assert.equal(r1.nextEntryId, b.id);
  const r2 = W.completeSet(s, b.id, b.sets[0].id, 90);
  assert.equal(r2.restSec, 90, 'group rest');
  assert.equal(r2.roundComplete, true);
  assert.equal(r2.nextEntryId, a.id, 'back to first exercise for round 2');
  const units = W.groupUnits(s);
  assert.equal(units.filter((u) => u.groupId).length, 1);
  assert.equal(units.length, s.entries.length - 1);
});

test('skip and add sets', () => {
  const s = fresh();
  const e = s.entries[1];
  W.skipEntry(s, e.id);
  assert.equal(e.status, 'skipped');
  const next = W.nextPendingEntryId(s, s.entries[0].id);
  assert.equal(next, s.entries[2].id, 'skipped entries are passed over');
  W.unskipEntry(s, e.id);
  const set = W.addSet(s, e.id);
  assert.equal(e.sets.length, 4);
  assert.deepEqual(set.planned, e.sets[0].planned);
  assert.equal(W.removeSet(s, e.id, set.id), true);
  assert.equal(e.sets.length, 3);
});

test('substitution before any set keeps planned exercise and plan', () => {
  const s = fresh();
  const e = s.entries[1]; // chest press machine
  W.setPlanned(s, e.id, e.sets[0].id, { weightKg: 50 });
  const r = W.substituteEntry(s, e.id, byId.get('ex_db_bench_press'), 'Machine busy', T0 + 5000);
  assert.equal(r, e);
  assert.equal(e.exerciseId, 'ex_db_bench_press');
  assert.equal(e.plannedExerciseId, 'ex_chest_press_machine');
  assert.equal(e.plannedExercise.name, 'Chest press machine');
  assert.equal(e.substitution.note, 'Machine busy');
  assert.equal(e.substitution.fromExerciseId, 'ex_chest_press_machine');
  assert.equal(e.sets[0].planned.weightKg, 50, 'prescription preserved');
  // Planned weight belongs to the planned exercise: not copied to the substitute on completion.
  W.completeSet(s, e.id, e.sets[0].id);
  assert.equal(e.sets[0].actual.weightKg, undefined);
  assert.equal(e.sets[0].actual.reps, 10);
});

test('swapping back to the planned exercise clears the substitution', () => {
  const s = fresh();
  const e = s.entries[1];
  W.substituteEntry(s, e.id, byId.get('ex_db_bench_press'), '');
  W.substituteEntry(s, e.id, byId.get('ex_chest_press_machine'), '');
  assert.equal(e.substitution, null);
});

test('substitution after some sets splits the entry', () => {
  const s = fresh();
  const e = s.entries[2]; // lat pulldown
  W.setActual(s, e.id, e.sets[0].id, { weightKg: 45, reps: 10 });
  W.completeSet(s, e.id, e.sets[0].id);
  const before = s.entries.length;
  const repl = W.substituteEntry(s, e.id, byId.get('ex_pull_up'), 'Station taken');
  assert.equal(s.entries.length, before + 1);
  assert.equal(e.sets.length, 1);
  assert.equal(e.status, 'done');
  assert.equal(e.exerciseId, 'ex_lat_pulldown');
  assert.equal(repl.exerciseId, 'ex_pull_up');
  assert.equal(repl.sets.length, 2);
  assert.ok(repl.sets.every((x) => !x.done && x.actual === null));
  assert.equal(repl.substitution.fromEntryId, e.id);
  assert.equal(s.entries[s.entries.indexOf(e) + 1], repl);
});

test('ad-hoc entries and removal', () => {
  const s = fresh();
  const n = s.entries.length;
  const e = W.addEntry(s, byId.get('ex_db_curl'), { sets: 2 });
  assert.equal(s.entries.length, n + 1);
  assert.equal(e.adHoc, true);
  assert.equal(e.plannedExerciseId, null);
  assert.equal(e.sets.length, 2);
  W.removeEntry(s, e.id);
  assert.equal(s.entries.length, n);
});

test('moving entries respects groups', () => {
  const s = fresh();
  const ids = () => s.entries.map((e) => e.exerciseId);
  const [a, b] = s.entries.filter((e) => e.groupId);
  W.moveEntry(s, a.id, 1);
  assert.equal(s.entries.indexOf(a), s.entries.indexOf(b) + 1, 'swapped within group');
  assert.equal(W.moveEntry(s, a.id, 1), false, 'cannot leave group by moving');
  const plank = s.entries.find((e) => e.exerciseId === 'ex_plank');
  W.moveEntry(s, plank.id, -1);
  assert.equal(ids().indexOf('ex_plank'), 3, 'single entry jumps over whole group');
});

test('link and unlink', () => {
  const s = fresh();
  const first = s.entries[0];
  const gid = W.linkWithNext(s, first.id, 'circuit');
  assert.ok(gid);
  assert.equal(s.entries[1].groupId, gid);
  assert.equal(s.groups.find((g) => g.id === gid).type, 'circuit');
  W.unlinkEntry(s, first.id);
  assert.equal(first.groupId, null);
  assert.equal(s.entries[1].groupId, null, 'single remaining member is ungrouped');
  assert.ok(!s.groups.find((g) => g.id === gid));
});

test('pause/resume excludes paused time and freezes rest timer', () => {
  const s = fresh();
  W.startRest(s, 60, null, T0 + 10_000);
  W.pauseSession(s, T0 + 20_000);
  assert.equal(W.restRemainingMs(s.rest, T0 + 100_000), 50_000);
  assert.equal(sessionElapsedSec(s, T0 + 80_000), 20);
  W.resumeSession(s, T0 + 80_000);
  assert.equal(s.pausedMs, 60_000);
  assert.equal(W.restRemainingMs(s.rest, T0 + 90_000), 40_000);
  W.finishSession(s, T0 + 200_000);
  assert.equal(s.status, 'completed');
  assert.equal(sessionElapsedSec(s, T0 + 999_999), 140);
  assert.equal(s.rest, null);
});

test('rest timer is timestamp based', () => {
  const s = fresh();
  W.startRest(s, 90, null, T0);
  assert.equal(W.restRemainingMs(s.rest, T0 + 30_000), 60_000);
  assert.equal(W.restRemainingMs(s.rest, T0 + 500_000), 0, 'returning late does not restart');
  W.adjustRest(s, 15, T0 + 30_000);
  assert.equal(W.restRemainingMs(s.rest, T0 + 30_000), 75_000);
  W.pauseRest(s, T0 + 40_000);
  assert.equal(W.restRemainingMs(s.rest, T0 + 400_000), 65_000);
  W.resumeRest(s, T0 + 400_000);
  assert.equal(W.restRemainingMs(s.rest, T0 + 405_000), 60_000);
  W.resetRest(s, T0 + 500_000);
  assert.equal(W.restRemainingMs(s.rest, T0 + 500_000), 105_000);
  assert.equal(W.startRest(s, 0), null);
  assert.equal(s.rest, null);
});

test('summary counts only done sets', () => {
  const s = fresh();
  const e = s.entries[0];
  W.setActual(s, e.id, e.sets[0].id, { weightKg: 100, reps: 10 });
  W.completeSet(s, e.id, e.sets[0].id);
  W.setActual(s, e.id, e.sets[1].id, { weightKg: 100, reps: 10 }); // typed but not done
  const sum = sessionSummary(s);
  assert.equal(sum.setsDone, 1);
  assert.equal(sum.volumeKg, 1000);
  assert.equal(sum.exercisesDone, 1);
});

test('activity session', () => {
  const run = byId.get('ex_running');
  const a = W.createActivitySession({ startedAt: T0, durationSec: 1800, distanceKm: 5, notes: 'nice' }, run, T0);
  assert.equal(a.kind, 'activity');
  assert.equal(a.status, 'completed');
  assert.equal(a.activity.exercise.name, 'Running');
  assert.equal(a.endedAt, T0 + 1_800_000);
  assert.equal(sessionSummary(a).distanceKm, 5);
});

test('set suggestions: plan, then previous set, then last time', () => {
  const s = W.createEmptySession(T0);
  const e = W.addEntry(s, byId.get('ex_bench_press'), { sets: 3 });
  const lastPerf = { sets: [{ weightKg: 60, reps: 8 }, { weightKg: 62.5, reps: 6 }] };
  let sug = W.suggestSetValues(e, 0, lastPerf);
  assert.deepEqual(sug.values, { weightKg: 60, reps: 8 });
  assert.equal(sug.source.weightKg, 'last');
  W.setActual(s, e.id, e.sets[0].id, { weightKg: 65, reps: 5 });
  W.completeSet(s, e.id, e.sets[0].id, 90, T0, W.suggestSetValues(e, 0, lastPerf).values);
  assert.deepEqual(e.sets[0].actual, { weightKg: 65, reps: 5 });
  sug = W.suggestSetValues(e, 1, lastPerf);
  assert.deepEqual(sug.values, { weightKg: 65, reps: 5 });
  assert.equal(sug.source.reps, 'previous');
  W.setPlanned(s, e.id, e.sets[2].id, { reps: 3 });
  sug = W.suggestSetValues(e, 2, lastPerf);
  assert.equal(sug.values.reps, 3);
  assert.equal(sug.source.reps, 'plan');
});
