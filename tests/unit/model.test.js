import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../../js/model.js';
import * as W from '../../js/workout-logic.js';
import { starterExercises, starterProgram } from '../../js/seed.js';

const DAY = 86400000;
const T0 = new Date(2026, 9, 12, 18, 0).getTime(); // Monday 12 Oct 2026
const ex = new Map(starterExercises(T0).map((e) => [e.id, e]));

function workout(at, exerciseId, sets) {
  const s = W.createEmptySession(at);
  const e = W.addEntry(s, ex.get(exerciseId), { sets: 0 });
  for (const v of sets) {
    const st = W.addSet(s, e.id);
    W.setActual(s, e.id, st.id, v);
    W.completeSet(s, e.id, st.id);
  }
  W.finishSession(s, at + 3600_000);
  return s;
}

test('calculations', () => {
  assert.equal(M.setVolumeKg({ weightKg: 50, reps: 10 }), 500);
  assert.equal(M.setVolumeKg({ reps: 10 }), 0);
  assert.equal(M.estimateOneRepMax(100, 1), 100);
  assert.ok(Math.abs(M.estimateOneRepMax(100, 10) - 133.333) < 0.01);
  assert.equal(M.estimateOneRepMax(100, 20), null, 'no estimate for high reps');
  assert.equal(M.paceSecPerKm(1500, 5), 300);
  assert.equal(M.speedKmh(3600, 25), 25);
  assert.equal(M.paceSecPerKm(0, 5), null);
});

test('exercise history never mixes exercises', () => {
  const s1 = workout(T0, 'ex_bench_press', [{ weightKg: 60, reps: 8 }, { weightKg: 62.5, reps: 6 }]);
  const s2 = workout(T0 + DAY, 'ex_db_bench_press', [{ weightKg: 24, reps: 10 }]);
  const h = M.exerciseHistory([s2, s1], 'ex_bench_press');
  assert.equal(h.length, 1);
  assert.equal(h[0].topWeightKg, 62.5);
  assert.equal(h[0].topWeightReps, 6);
  assert.equal(h[0].totalReps, 14);
  assert.equal(h[0].volumeKg, 60 * 8 + 62.5 * 6);
  assert.equal(M.exerciseHistory([s1, s2], 'ex_db_bench_press')[0].topWeightKg, 24);
});

test('last performance picks most recent completed session', () => {
  const s1 = workout(T0, 'ex_back_squat', [{ weightKg: 80, reps: 5 }]);
  const s2 = workout(T0 + 2 * DAY, 'ex_back_squat', [{ weightKg: 85, reps: 5 }]);
  const active = W.createEmptySession(T0 + 3 * DAY);
  W.addEntry(active, ex.get('ex_back_squat'));
  const last = M.lastPerformance([s1, active, s2], 'ex_back_squat', active.id);
  assert.equal(last.sessionId, s2.id);
  assert.equal(last.sets[0].weightKg, 85);
  assert.equal(M.lastPerformance([s1], 'ex_plank'), null);
});

test('records and new-record detection', () => {
  const s1 = workout(T0, 'ex_back_squat', [{ weightKg: 80, reps: 5 }]);
  const s2 = workout(T0 + DAY, 'ex_back_squat', [{ weightKg: 90, reps: 3 }]);
  const s3 = workout(T0 + 2 * DAY, 'ex_back_squat', [{ weightKg: 85, reps: 3 }]);
  const recs = M.computeRecords([s1, s2, s3]).get('ex_back_squat');
  assert.equal(recs.maxWeightKg.value, 90);
  assert.equal(recs.maxWeightKg.sessionId, s2.id);
  assert.equal(recs.maxReps.value, 5);
  const firstTime = M.newRecordsIn(s1, [s1]);
  assert.equal(firstTime.length, 0, 'first performance is a baseline');
  const pr = M.newRecordsIn(s2, [s1, s2, s3]);
  assert.ok(pr.some((r) => r.key === 'maxWeightKg' && r.value === 90 && r.previous === 80));
  assert.equal(M.newRecordsIn(s3, [s1, s2, s3]).filter((r) => r.key === 'maxWeightKg').length, 0);
});

test('cardio records include activities and pace is lower-is-better', () => {
  const run = ex.get('ex_running');
  const a1 = W.createActivitySession({ startedAt: T0, durationSec: 1800, distanceKm: 5 }, run);
  const a2 = W.createActivitySession({ startedAt: T0 + DAY, durationSec: 1500, distanceKm: 5 }, run);
  const r = M.computeRecords([a1, a2]).get('ex_running');
  assert.equal(r.bestPaceSecPerKm.value, 300);
  assert.equal(r.longestDurationSec.value, 1800);
  const h = M.exerciseHistory([a1, a2], 'ex_running');
  assert.equal(h.length, 2);
  assert.equal(h[1].distanceKm, 5);
});

test('weekly progress and streak', () => {
  const settings = M.withDefaults({ weeklyGoal: 2 });
  const mon = T0;
  const sessions = [
    workout(mon, 'ex_plank', [{ durationSec: 30 }]),
    W.createActivitySession({ startedAt: mon + DAY, durationSec: 600, distanceKm: 2 }, ex.get('ex_walking')),
    workout(mon - 7 * DAY, 'ex_plank', [{ durationSec: 30 }]),
    workout(mon - 5 * DAY, 'ex_plank', [{ durationSec: 30 }]),
  ];
  const p = M.weekProgress(sessions, settings, mon + 2 * DAY);
  assert.equal(p.count, 2);
  assert.equal(p.remaining, 0);
  assert.equal(p.days.length, 7);
  assert.equal(p.days[0].count, 1);
  assert.equal(p.distanceKm, 2);
  const noAct = M.weekProgress(sessions, { ...settings, countActivitiesInGoal: false }, mon + 2 * DAY);
  assert.equal(noAct.count, 1);
  assert.equal(M.goalStreak(sessions, settings, mon + 2 * DAY), 2);
});

test('next template rotates within the last used program', () => {
  const { program, templates } = starterProgram(T0);
  assert.equal(M.suggestNextTemplate([program], templates, []).template.id, 'tpl_starter_a');
  const s = W.createSessionFromTemplate(templates[0], program, ex, T0);
  W.finishSession(s, T0 + 1000);
  assert.equal(M.suggestNextTemplate([program], templates, [s]).template.id, 'tpl_starter_b');
  const s2 = W.createSessionFromTemplate(templates[1], program, ex, T0 + DAY);
  W.finishSession(s2, T0 + DAY + 1000);
  assert.equal(M.suggestNextTemplate([program], templates, [s, s2]).template.id, 'tpl_starter_a');
  assert.equal(M.suggestNextTemplate([], templates, [s]), null);
});

test('withDefaults keeps user values', () => {
  const st = M.withDefaults({ weeklyGoal: 5, measurementTypes: [] });
  assert.equal(st.weeklyGoal, 5);
  assert.equal(st.defaultRestSec, 90);
  assert.equal(st.measurementTypes.length, 2);
});
