import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseDateTime, parseLooseDuration, buildCsvImport, exampleCsv, mapHeader } from '../../js/csv-import.js';
import { starterExercises } from '../../js/seed.js';
import { sessionSummary, exerciseHistory } from '../../js/model.js';
import { validateData } from '../../js/validate.js';

const T0 = new Date(2026, 9, 12).getTime();
const exercises = starterExercises(T0);

test('csv parser handles quotes, delimiters and line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","he said ""hi"""\n'), [['a', 'b'], ['x, y', 'he said "hi"']]);
  assert.deepEqual(parseCsv('a;b\n1,5;2\n'), [['a', 'b'], ['1,5', '2']]);
  assert.deepEqual(parseCsv('﻿a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parseCsv('a,b\n"multi\nline",2'), [['a', 'b'], ['multi\nline', '2']]);
});

test('dates in common formats; ambiguous ones rejected', () => {
  const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
  assert.equal(parseDateTime('2025-03-01 18:30'), at(2025, 3, 1, 18, 30));
  assert.equal(parseDateTime('2025-03-01T18:30:15'), at(2025, 3, 1, 18, 30) + 15000);
  assert.equal(parseDateTime('2025-03-01'), at(2025, 3, 1));
  assert.equal(parseDateTime('15 Jan 2025, 18:02'), at(2025, 1, 15, 18, 2));
  assert.equal(parseDateTime('01.03.2025 07:05'), at(2025, 3, 1, 7, 5));
  assert.equal(parseDateTime('25/03/2025'), at(2025, 3, 25));
  assert.equal(parseDateTime('03/25/2025'), at(2025, 3, 25));
  assert.equal(parseDateTime('03/04/2025'), null, 'ambiguous day/month');
  assert.equal(parseDateTime('2025-02-30'), null);
  assert.equal(parseDateTime('yesterday'), null);
});

test('durations', () => {
  assert.equal(parseLooseDuration('1h 5m'), 3900);
  assert.equal(parseLooseDuration('45m'), 2700);
  assert.equal(parseLooseDuration('1:05:00'), 3900);
  assert.equal(parseLooseDuration('55'), 3300, 'plain numbers are minutes');
  assert.equal(parseLooseDuration('90 sec'), 90);
});

test('header aliases', () => {
  const { map } = mapHeader(['Date', 'Workout Name', 'Exercise Name', 'Set Order', 'Weight (kg)', 'Reps', 'Distance (km)', 'Seconds', 'Notes', 'Workout Notes', 'RPE', 'Duration (sec)']);
  assert.equal(map.date, 0);
  assert.equal(map.workout, 1);
  assert.equal(map.exercise, 2);
  assert.equal(map.weightKg, 4);
  assert.equal(map.workoutNotes, 9);
  assert.equal(map.durationSecs, 11);
});

test('example file imports into valid sessions; existing exercises are matched', () => {
  const r = buildCsvImport(exampleCsv(), { exercises, sessions: [], fileName: 'ex.csv', now: T0 });
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.stats.workouts, 1);
  assert.equal(r.stats.sets, 6);
  assert.equal(r.newExercises.length, 0, 'all example exercises exist in the starter library');
  const s = r.sessions[0];
  assert.equal(s.name, 'Full body A');
  assert.equal(s.endedAt - s.startedAt, 55 * 60000);
  assert.deepEqual(s.entries.map((e) => e.exercise.name), ['Barbell back squat', 'Dumbbell bench press', 'Plank', 'Treadmill']);
  const squat = s.entries[0];
  assert.equal(squat.sets[0].kind, 'warmup');
  assert.equal(squat.sets[2].actual.rpe, 8.5);
  assert.equal(squat.sets[2].note, 'felt heavy');
  // Per-hand dumbbell weight from the library is applied to volume.
  const sum = sessionSummary(s);
  assert.equal(sum.setsDone, 5);
  assert.equal(sum.volumeKg, 80 * 5 * 2 + 22 * 10 * 2);
  assert.equal(exerciseHistory(r.sessions, 'ex_back_squat')[0].topWeightKg, 80);
  assert.deepEqual(validateData({ exercises, programs: [], templates: [], sessions: r.sessions, measurements: [] }).errors, []);
  // Re-importing the same file skips existing workouts.
  const again = buildCsvImport(exampleCsv(), { exercises, sessions: r.sessions, now: T0 });
  assert.equal(again.stats.workouts, 0);
  assert.equal(again.stats.duplicates, 1);
});

test('Strong-style export: lb conversion, W/D set order, new exercises created with a guessed type', () => {
  const csv = [
    'Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps;Distance;Seconds;Notes;Workout Notes;RPE',
    '2024-01-15 18:02:11;Push;1h 5m;Bench Press (Barbell);W;95;10;0;0;;Good;',
    '2024-01-15 18:02:11;Push;1h 5m;Bench Press (Barbell);1;185;5;0;0;;Good;8',
    '2024-01-15 18:02:11;Push;1h 5m;Cable Fly Crossover;1;30;12;0;0;;Good;',
    '2024-01-15 18:02:11;Push;1h 5m;Hanging Leg Raise;1;0;15;0;0;;Good;',
    '2024-01-17 07:00:00;Run;30m;Running (Outdoor);1;0;0;5,2;1800;;;',
    'bad date;Push;;Bench Press (Barbell);1;100;5;0;0;;;',
  ].join('\n');
  const r = buildCsvImport(csv, { exercises, sessions: [], weightUnit: 'lb', now: T0 });
  assert.equal(r.ok, true, r.errors.join());
  assert.equal(r.stats.workouts, 2);
  assert.equal(r.skipped.length, 1);
  assert.match(r.skipped[0], /Row 7: date "bad date"/);
  const push = r.sessions[0];
  assert.equal(push.endedAt - push.startedAt, 3900 * 1000);
  assert.equal(push.notes, 'Good');
  const bench = push.entries[0];
  assert.equal(bench.sets[0].kind, 'warmup');
  assert.equal(bench.sets[1].actual.weightKg, 83.91, '185 lb → kg');
  const types = Object.fromEntries(r.newExercises.map((e) => [e.name, e.type]));
  assert.deepEqual(types, { 'Bench Press (Barbell)': 'strength', 'Cable Fly Crossover': 'strength', 'Hanging Leg Raise': 'bodyweight', 'Running (Outdoor)': 'cardio' });
  const run = r.sessions[1].entries[0].sets[0].actual;
  assert.deepEqual(run, { distanceKm: 5.2, durationSec: 1800 });
  assert.equal(push.entries[2].sets[0].actual.weightKg, 0, 'bodyweight set keeps 0 kg');
});

test('missing required columns and empty files', () => {
  assert.match(buildCsvImport('foo,bar\n1,2', {}).errors.join(), /No date column/);
  assert.match(buildCsvImport('', {}).errors.join(), /no data rows/);
  const r = buildCsvImport('date,exercise,reps\n2025-01-01,Squat,abc', { exercises: [] });
  assert.equal(r.ok, false);
  assert.match(r.skipped[0], /invalid number in reps/);
});
