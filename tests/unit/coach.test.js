import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../js/coach.js';
import * as W from '../../js/workout-logic.js';
import { starterExercises, starterProgram } from '../../js/seed.js';
import { withDefaults, MUSCLES } from '../../js/model.js';
import { STARTER_INFO, starterInfoFields } from '../../js/exercise-info.js';
import { migrateData } from '../../js/migrations.js';
import { musclesFor, muscleMapSvg, MAPPED_MUSCLES } from '../../js/muscle-map.js';

const DAY = 86400000;
const NOW = new Date(2026, 10, 10, 12, 0).getTime();

function fixture() {
  const exercises = starterExercises(NOW - 100 * DAY);
  const byId = new Map(exercises.map((e) => [e.id, e]));
  const { program, templates } = starterProgram(NOW - 100 * DAY);
  const sessions = [];
  for (let i = 0; i < 6; i++) {
    const at = NOW - (60 - i * 10) * DAY;
    const s = W.createSessionFromTemplate(templates[0], program, byId, at);
    const e = s.entries[0];
    for (const st of e.sets) { W.setActual(s, e.id, st.id, { weightKg: 100 + i * 5, reps: 10 }); W.completeSet(s, e.id, st.id); }
    W.finishSession(s, at + 3600_000);
    sessions.push(s);
  }
  sessions.push(W.createActivitySession({ startedAt: NOW - 3 * DAY, durationSec: 1800, distanceKm: 5 }, byId.get('ex_running')));
  return {
    exercises, programs: [program], templates, sessions,
    measurements: [{ id: 'm1', typeId: 'bodyweight', date: NOW - 5 * DAY, value: 82, unit: 'kg' }],
    settings: withDefaults({ weeklyGoal: 3 }),
  };
}

test('starter info covers every starter exercise with valid muscle names', () => {
  for (const e of starterExercises()) {
    assert.ok(STARTER_INFO[e.id], `missing info for ${e.id}`);
    for (const m of STARTER_INFO[e.id].primary) assert.ok(MUSCLES.includes(m), `${e.id}: ${m}`);
    for (const m of e.muscles) assert.ok(MUSCLES.includes(m), `${e.id} muscles: ${m}`);
  }
  assert.ok(starterExercises().find((e) => e.id === 'ex_back_squat').instructions.split('\n').length >= 4);
});

test('migration v2 → v3 fills starter how-to only where empty', () => {
  const ex = starterExercises().map(({ cues, commonMistakes, primaryMuscles, ...rest }) => ({ ...rest, instructions: rest.id === 'ex_bench_press' ? 'My own steps' : '' }));
  const custom = { id: 'ex_mine', name: 'Mine', type: 'strength', builtIn: false, instructions: '' };
  const out = migrateData({ exercises: [...ex, custom], sessions: [], programs: [], templates: [], measurements: [] }, 2, 3);
  const by = new Map(out.exercises.map((e) => [e.id, e]));
  assert.equal(by.get('ex_bench_press').instructions, 'My own steps', 'user text kept');
  assert.equal(by.get('ex_bench_press').cues, starterInfoFields('ex_bench_press').cues, 'empty field filled');
  assert.equal(by.get('ex_back_squat').instructions, starterInfoFields('ex_back_squat').instructions);
  assert.deepEqual(by.get('ex_back_squat').primaryMuscles, ['Quads', 'Glutes']);
  assert.deepEqual(by.get('ex_mine').primaryMuscles, []);
  assert.equal(by.get('ex_mine').cues, '');
});

test('muscle map: primary/secondary split and every muscle drawn', () => {
  assert.deepEqual(musclesFor({ muscles: ['Quads', 'Glutes', 'Adductors'], primaryMuscles: ['Quads'] }), { primary: ['Quads'], secondary: ['Glutes', 'Adductors'] });
  assert.deepEqual(musclesFor({ muscles: ['Chest', 'Triceps'] }).primary, ['Chest'], 'first muscle is primary when none marked');
  for (const m of MUSCLES.filter((x) => x !== 'Cardiovascular')) assert.ok(MAPPED_MUSCLES.includes(m), `${m} has a region`);
  const svg = muscleMapSvg({ muscles: ['Lats', 'Biceps'], primaryMuscles: ['Lats'] });
  assert.match(svg, /class="mm-primary" data-muscle="Lats"/);
  assert.match(svg, /class="mm-secondary" data-muscle="Biceps"/);
  assert.match(svg, /Primary: Lats\. Secondary: Biceps\./);
});

test('coach export: window, summaries, optional body data', () => {
  const d = fixture();
  const exp = C.buildCoachExport(d, { weeks: 4, goals: 'Stronger legs', now: NOW, exportId: 'exp_1', appVersion: '1.3.0' });
  assert.equal(exp.format, C.COACH_EXPORT_FORMAT);
  assert.equal(exp.athlete.goals, 'Stronger legs');
  assert.ok(exp.history.length < d.sessions.length, 'only sessions in the window');
  assert.ok(exp.history.every((h) => h.date >= exp.historyWindow.from));
  const legPress = exp.summary.perExercise.find((p) => p.exerciseId === 'ex_leg_press');
  assert.equal(legPress.sessionsTotal, 6, 'trends use all history');
  assert.equal(legPress.bestTopWeightKg, 125);
  assert.ok(exp.exercises.find((e) => e.id === 'ex_back_squat').instructions);
  assert.equal(exp.bodyMeasurements, undefined, 'body data off by default');
  const withBody = C.buildCoachExport(d, { weeks: 'all', includeBody: true, now: NOW });
  assert.equal(withBody.bodyMeasurements.entries[0].value, 82);
  assert.equal(withBody.history.length, d.sessions.length);
  const w = withBody.history.find((h) => h.kind === 'workout');
  assert.ok(w.exercises[0].sets[0].planned && w.exercises[0].sets[0].actual && w.exercises[0].sets[0].done);
  assert.equal(JSON.stringify(exp).includes('null'), false, 'empty values are dropped to save tokens');
});

test('coach prompt explains data and answer format, embeds data on request', () => {
  const exp = C.buildCoachExport(fixture(), { weeks: 12, now: NOW, exportId: 'exp_x' });
  const p = C.coachPrompt(exp);
  assert.match(p, /attached file "training-diary-coach-2026-11-10\.json"/);
  assert.match(p, /History can never be changed/);
  assert.match(p, /"format": "training-diary-plan"/);
  assert.ok(!p.includes('"exportId":"exp_x"'), 'data not embedded by default');
  const e = C.coachPrompt(exp, { embedData: true });
  assert.ok(e.includes('"exportId":"exp_x"'));
  assert.match(e, /JSON data at the end of this message/);
});

const planText = (plan) => `Here is my analysis...\n\n- point one\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\nGood luck!`;

test('extractPlan finds the JSON block and explains failures', () => {
  const plan = { format: C.PLAN_FORMAT, version: 1, templates: {} };
  assert.deepEqual(C.extractPlan(planText(plan)).plan, plan);
  assert.deepEqual(C.extractPlan(JSON.stringify(plan)).plan, plan, 'raw JSON works');
  assert.match(C.extractPlan('Just advice, no json').error, /No JSON/);
  assert.match(C.extractPlan('```json\n{"format": "training-diary-plan", }\n```').error, /not valid/);
  assert.match(C.extractPlan(JSON.stringify({ format: C.COACH_EXPORT_FORMAT })).error, /data export/);
  assert.match(C.extractPlan('').error, /empty/);
});

function bigPlan() {
  return {
    format: C.PLAN_FORMAT, version: 1, basedOnExportId: 'exp_1', summary: 'Upper/lower split.',
    history: [{ hacked: true }],
    exercises: {
      add: [{ tempId: 'new:wide-row', name: 'Wide-grip cable row', type: 'strength', category: 'Back', equipment: 'Cable', muscles: ['Upper back', 'Rear delts', 'Wings'], primaryMuscles: ['Upper back'], instructions: ['Sit', 'Pull'], videoUrl: 'https://example.com', reason: 'Upper back volume' }],
      update: [{ id: 'ex_leg_press', changes: { defaultRestSec: 150, cues: 'Drive through heels', notes: 'try to overwrite' }, reason: 'Heavier sets' }],
      archive: [{ id: 'ex_chest_fly', reason: 'Redundant' }],
    },
    programs: { add: [{ tempId: 'new:ul', name: 'Upper / Lower', reason: 'New split' }] },
    templates: {
      add: [{
        tempId: 'new:upper', programId: 'new:ul', name: 'Upper A', reason: 'Split',
        items: [
          { exerciseId: 'ex_bench_press', sets: 3, reps: 6, repsMax: 8, weightKg: 70 },
          { exerciseId: 'new:wide-row', sets: 3, reps: 10, groupId: 'g1' },
          { exerciseId: 'ex_face_pull', sets: 3, reps: 15, groupId: 'g1' },
        ],
        groups: [{ id: 'g1', type: 'superset', restSec: 90 }],
      }],
      update: [{ id: 'tpl_starter_a', changes: { items: [{ exerciseId: 'ex_leg_press', sets: 4, reps: 8, repsMax: 10, weightKg: 130 }, { exerciseId: 'ex_chest_fly', sets: 2, reps: 12 }] }, reason: 'More legs' }],
      remove: [{ id: 'tpl_starter_b', reason: 'Replaced' }],
    },
  };
}

test('reviewPlan validates, resolves tempIds and tracks dependencies', () => {
  const d = fixture();
  const r = C.reviewPlan(bigPlan(), d, { lastExport: { id: 'exp_1', at: NOW } });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => /"history" was ignored/.test(w)));
  const by = (entity, op) => r.changes.filter((c) => c.entity === entity && c.op === op);
  const add = by('exercise', 'add')[0];
  assert.equal(add.valid, true);
  assert.deepEqual(add.after.muscles, ['Upper back', 'Rear delts']);
  assert.equal(add.after.instructions, 'Sit\nPull', 'list joined into lines');
  assert.ok(add.notes.some((n) => /Wings/.test(n)));
  assert.ok(add.notes.some((n) => /links and media/.test(n)));
  assert.ok(!add.notes.some((n) => /Unknown field "(tempId|reason)"/.test(n)), 'format fields are not reported as unknown');
  const upd = by('exercise', 'update')[0];
  assert.deepEqual(upd.patch, { defaultRestSec: 150, cues: 'Drive through heels' });
  assert.ok(upd.notes.some((n) => /Personal notes/.test(n)));
  const arch = by('exercise', 'archive')[0];
  assert.ok(arch.notes.some((n) => /Still used in: Full body A/.test(n)), 'archived exercise still used by the updated template');
  const tAdd = by('template', 'add')[0];
  assert.equal(tAdd.valid, true);
  assert.equal(tAdd.deps.length, 2, 'depends on new exercise and new program');
  assert.equal(tAdd.after.items[1].exerciseName, 'Wide-grip cable row');
  assert.equal(tAdd.after.groups.length, 1);
  assert.equal(by('template', 'update')[0].valid, true);
  assert.equal(by('template', 'remove')[0].valid, true);
});

test('reviewPlan rejects bad references, duplicates and out-of-range values', () => {
  const d = fixture();
  const plan = {
    format: C.PLAN_FORMAT, version: 1,
    exercises: {
      add: [
        { tempId: 'new:dup', name: 'barbell BENCH press', type: 'strength' },
        { tempId: 'new:bad', name: 'Mystery', type: 'magic' },
      ],
      update: [{ id: 'ex_nope', changes: { name: 'X' } }],
    },
    templates: {
      add: [
        { tempId: 'new:t1', programId: 'prg_starter', name: 'Uses bad', items: [{ exerciseId: 'new:bad', sets: 3, reps: 10 }] },
        { tempId: 'new:t2', name: 'No program', items: [{ exerciseId: 'ex_bench_press', sets: 99, reps: 10 }] },
        { tempId: 'new:t3', programId: 'prg_starter', name: 'Ghost', items: [{ exerciseId: 'ex_ghost' }] },
      ],
    },
  };
  const r = C.reviewPlan(plan, d);
  const [dup, bad, missing, t1, t2, t3] = r.changes;
  assert.match(dup.problems.join(), /already exists/);
  assert.match(bad.problems.join(), /Unknown type "magic"/);
  assert.match(missing.problems.join(), /does not exist/);
  assert.match(t1.problems.join(), /Needs "Mystery"/, 'invalid dependency propagates');
  assert.match(t2.problems.join(), /programId is required/);
  assert.match(t2.problems.join(), /sets must be 1–20/);
  assert.match(t3.problems.join(), /ex_ghost/);
  assert.ok(r.changes.every((c) => !c.valid));
  assert.equal(C.reviewPlan({ format: 'x' }, d).ok, false);
  assert.match(C.reviewPlan({ format: C.PLAN_FORMAT, version: 9 }, d).errors[0], /version 9/);
});

test('applyPlan applies selected changes, maps ids and never touches history', () => {
  const d = fixture();
  const historyBefore = JSON.stringify(d.sessions);
  const r = C.reviewPlan(bigPlan(), d);
  const all = r.changes.filter((c) => c.valid).map((c) => c.key);
  const out = C.applyPlan(d, r, all, NOW);
  assert.equal(out.skipped.length, 0);
  const row = out.exercises.find((e) => e.name === 'Wide-grip cable row');
  assert.ok(row && row.id.startsWith('ex_') && !row.id.startsWith('new:'));
  assert.equal(out.exercises.find((e) => e.id === 'ex_leg_press').defaultRestSec, 150);
  assert.equal(out.exercises.find((e) => e.id === 'ex_chest_fly').archived, true);
  const prog = out.programs.find((p) => p.name === 'Upper / Lower');
  const upper = out.templates.find((t) => t.name === 'Upper A');
  assert.equal(upper.programId, prog.id);
  assert.equal(upper.items[1].exerciseId, row.id, 'tempId replaced by the real id');
  assert.equal(upper.items[1].groupId, upper.items[2].groupId);
  assert.equal(upper.groups[0].id, upper.items[1].groupId);
  const a = out.templates.find((t) => t.id === 'tpl_starter_a');
  assert.equal(a.items.length, 2);
  assert.equal(a.items[0].repsMax, 10);
  assert.ok(!out.templates.some((t) => t.id === 'tpl_starter_b'));
  assert.equal(JSON.stringify(d.sessions), historyBefore, 'history unchanged');
  assert.equal(out.sessions, undefined, 'applyPlan does not even return sessions');
  // Input data is not mutated.
  assert.ok(d.templates.some((t) => t.id === 'tpl_starter_b'));
});

test('applyPlan skips changes whose dependency was not selected', () => {
  const d = fixture();
  const r = C.reviewPlan(bigPlan(), d);
  const exAdd = r.changes.find((c) => c.entity === 'exercise' && c.op === 'add');
  const tAdd = r.changes.find((c) => c.entity === 'template' && c.op === 'add');
  assert.ok(C.dependentsOf(r.changes, exAdd.key).has(tAdd.key));
  assert.ok(C.dependenciesOf(r.changes, tAdd.key).has(exAdd.key));
  const keys = r.changes.filter((c) => c.valid && c.key !== exAdd.key).map((c) => c.key);
  const out = C.applyPlan(d, r, keys, NOW);
  assert.ok(out.skipped.includes(tAdd.key));
  assert.ok(!out.templates.some((t) => t.name === 'Upper A'));
});

test('describeItems', () => {
  assert.deepEqual(C.describeItems([{ exerciseName: 'Bench', sets: 3, reps: 6, repsMax: 8, weightKg: 70, groupId: 'g' }]), [{ exerciseId: undefined, group: 'g', text: 'Bench: 3 × 6–8 @ 70 kg' }]);
});

test('exercise details: detect gaps, export only chosen exercises, prompt', () => {
  const d = fixture();
  const custom = { id: 'ex_custom_row', name: 'Pendlay row', type: 'strength', category: 'Other', equipment: 'Other', muscles: [], primaryMuscles: [], instructions: '', cues: '', commonMistakes: '', description: '', archived: false };
  const cardio = { id: 'ex_custom_ski', name: 'Ski erg', type: 'cardio', muscles: ['Cardiovascular'], primaryMuscles: ['Cardiovascular'], instructions: 'Pull', description: 'Ski erg.' };
  d.exercises.push(custom, cardio, { ...custom, id: 'ex_old', name: 'Old', archived: true });
  assert.deepEqual(C.missingDetails(custom), ['description', 'instructions', 'muscles', 'primaryMuscles', 'cues', 'commonMistakes']);
  assert.deepEqual(C.missingDetails(cardio), [], 'cardio needs no cues/mistakes');
  assert.deepEqual(C.missingDetails(d.exercises.find((e) => e.id === 'ex_bench_press')), ['description'], 'starter: only the optional description');
  assert.deepEqual(C.exercisesNeedingDetails(d.exercises).map((e) => e.id), ['ex_custom_row'], 'starters are complete; archived ignored');
  const exp = C.buildExerciseExport(d, ['ex_custom_row'], { now: NOW, exportId: 'exp_e' });
  assert.equal(exp.format, C.EXERCISE_EXPORT_FORMAT);
  assert.equal(exp.exercisesToComplete.length, 1);
  assert.deepEqual(exp.exercisesToComplete[0].missing, C.missingDetails(custom));
  assert.ok(exp.libraryForAlternatives.some((e) => e.id === 'ex_barbell_row'));
  assert.ok(!exp.libraryForAlternatives.some((e) => e.id === 'ex_old' || e.id === 'ex_custom_row'));
  const p = C.exercisePrompt(exp);
  assert.match(p, /Only output exercise updates/);
  assert.ok(p.includes('"id":"ex_custom_row"'), 'data embedded');
  assert.match(C.extractPlan(JSON.stringify(exp)).error, /data export/);
  // A typical answer goes through the normal review and apply.
  const answer = { format: C.PLAN_FORMAT, version: 1, basedOnExportId: 'exp_e', exercises: { update: [{ id: 'ex_custom_row', changes: { description: 'Strict barbell row from the floor.', instructions: 'Set up\nRow\nReturn', cues: 'Flat back', commonMistakes: 'Jerking', muscles: ['Upper back', 'Lats', 'Lower back'], primaryMuscles: ['Upper back'], equipment: 'Barbell', category: 'Back', alternativeIds: ['ex_barbell_row', 'ex_unknown'] }, reason: 'Filled' }] } };
  const r = C.reviewPlan(answer, d, { lastExport: { id: 'exp_e', at: NOW } });
  const c = r.changes[0];
  assert.equal(c.valid, true);
  assert.deepEqual(c.patch.alternativeIds, ['ex_barbell_row']);
  const out = C.applyPlan(d, r, [c.key], NOW);
  const row = out.exercises.find((e) => e.id === 'ex_custom_row');
  assert.equal(row.equipment, 'Barbell');
  assert.deepEqual(row.primaryMuscles, ['Upper back']);
  assert.deepEqual(C.missingDetails(row), []);
  assert.deepEqual(C.exercisesNeedingDetails(out.exercises), []);
});

test('exercise prompt can refer to a file; cut-off answers are explained', () => {
  const d = fixture();
  const exp = C.buildExerciseExport(d, ['ex_bench_press'], { now: NOW, exportId: 'exp_f' });
  const p = C.exercisePrompt(exp, { embedData: false, fileName: 'x.json' });
  assert.match(p, /Attached is the file "x\.json"/);
  assert.ok(!p.includes('"exportId":"exp_f"'), 'data not embedded');
  assert.equal(C.exerciseFileName(exp, 2), 'training-diary-exercises-2026-11-10-part-2.json');
  const cut = 'Sure!\n```json\n{"format": "training-diary-plan", "version": 1, "exercises": {"update": [{"id": "ex_bench_press", "changes": {"cues": "Brace';
  assert.match(C.extractPlan(cut).error, /cut off/);
  const ok = 'Text\n```json\n{"format":"training-diary-plan","version":1}\n```\nmore';
  assert.equal(C.extractPlan(ok).ok, true, 'normal answers unaffected');
});

test('answers from any recent export (batches) are recognised', () => {
  const d = fixture();
  const plan = { format: C.PLAN_FORMAT, version: 1, basedOnExportId: 'exp_batch1', exercises: { update: [{ id: 'ex_bench_press', changes: { description: 'Flat barbell press.' }, reason: 'x' }] } };
  const exports = [{ id: 'exp_batch1', at: NOW }, { id: 'exp_batch2', at: NOW + 1 }];
  const ok = C.reviewPlan(plan, d, { lastExport: exports[1], exports });
  assert.ok(!ok.warnings.some((w) => /recent exports/.test(w)), 'earlier batch is fine');
  const unknown = C.reviewPlan({ ...plan, basedOnExportId: 'exp_other' }, d, { lastExport: exports[1], exports });
  assert.ok(unknown.warnings.some((w) => /not made from one of your recent exports/.test(w)));
  const fileP = C.exercisePrompt(C.buildExerciseExport(d, ['ex_bench_press'], { now: NOW }), { embedData: false });
  assert.match(fileP, /"basedOnExportId": "<exportId from the attached file>"/);
});
