// Quick log: enter what was done after the workout, one row per exercise.
// No timers or per-set ticking. Saves an ordinary completed workout, so history,
// progress and records work the same as for live workouts.

import * as store from '../store.js';
import * as W from '../workout-logic.js';
import { h, append, btn, iconBtn, pageHead, field, input, numInput, select, textarea, toast, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { navigate } from '../shell.js';
import { pickExercise } from './library.js';
import { fieldsForType, lastPerformance } from '../model.js';
import { num, fmtDateShort, isoDateTimeLocal, parseLocalDate, plural, parseDuration } from '../util.js';
import { fmtSetsCompact } from './workout.js';

/** [label, unit] for the weight input of an exercise. */
function weightField(ex) {
  if (ex.lowerIsBetter) return ['Assistance', 'kg'];
  if (ex.weightMode === 'perHand') return ['Weight', 'kg per dumbbell'];
  return ex.type === 'bodyweight' ? ['Added weight', 'kg, optional'] : ['Weight', 'kg'];
}

export function renderQuick({ el, query }) {
  const programs = store.programsSorted().filter((p) => !p.archived);
  const options = [['none', 'No template (choose exercises)']];
  for (const p of programs) for (const t of store.templatesFor(p.id)) options.push([t.id, `${p.name} – ${t.name}`]);
  const tplId = store.templateById(query.tpl) ? query.tpl : 'none';
  const template = tplId === 'none' ? null : store.templateById(tplId);
  const exMap = new Map(store.state.exercises.map((e) => [e.id, e]));
  const last = (id) => lastPerformance(store.state.sessions, id);

  let rows = template
    ? (template.items || []).map((it) => {
      const ex = exMap.get(it.exerciseId);
      return ex ? W.quickRowDefaults(ex, it, last(ex.id)) : null;
    }).filter(Boolean)
    : [];

  el.append(pageHead(template ? template.name : 'Log workout', { back: '#/', kicker: 'Log after training' }));
  const tplSel = select(options, tplId, { 'aria-label': 'Workout' });
  tplSel.addEventListener('change', () => navigate(`#/quick${tplSel.value === 'none' ? '' : `?tpl=${tplSel.value}`}`, { replace: true }));
  const when = input({ type: 'datetime-local', value: isoDateTimeLocal(Date.now()), max: isoDateTimeLocal(Date.now() + 3600000) });
  const mins = numInput(null, { integer: true, placeholder: 'optional' });
  const notes = textarea('', { rows: 2, maxlength: 2000, placeholder: 'Optional' });
  el.append(h('section', { class: 'card form quick-head' },
    field('Workout', tplSel),
    h('div', { class: 'quick-when' }, field('When', when), field('Duration', mins, { unit: 'minutes' }))));

  el.append(h('p', { class: 'muted small' }, 'Weights are filled in from last time. Change what was different, mark anything you skipped, and save.'));
  const list = h('div', { class: 'quick-list' });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  el.append(err, list);

  function draw() {
    list.replaceChildren(...rows.map((r, i) => rowCard(r, i)));
    if (!rows.length) list.append(emptyState('No exercises yet', 'Add the exercises you did.', null, 'train'));
  }

  function rowCard(r, i) {
    const ex = exMap.get(r.exerciseId);
    const fields = fieldsForType(ex.type);
    const lp = last(ex.id);
    const card = h('article', { class: ['card', 'quick-row', r.skipped ? 'is-skipped' : ''], 'aria-label': ex.name });
    const setsLabel = () => (fields.includes('reps') ? `${r.sets} × ${r.reps ?? '?'}${r.repsMax ? `–${r.repsMax}` : ''}` : plural(r.sets, 'set'));
    const inputs = [];
    const put = (f, label, unit, opts = {}) => {
      const shown = f === 'durationSec' && ex.type === 'cardio' ? (Number.isFinite(r[f]) ? Math.round(r[f] / 6) / 10 : null) : r[f];
      const inp = numInput(shown, { integer: f === 'reps' || (f === 'durationSec' && ex.type !== 'cardio'), class: 'quick-input', 'aria-label': `${ex.name}: ${label}`, disabled: r.skipped, ...opts });
      inp.addEventListener('input', () => {
        const v = f === 'durationSec' && ex.type === 'cardio' ? parseDuration(inp.value) : num(inp.value);
        r[f] = v === null || v < 0 ? null : (f === 'reps' ? Math.round(v) : v);
      });
      inputs.push(field(label, inp, { unit, class: 'quick-field' }));
    };
    if (fields.includes('weightKg')) put('weightKg', ...weightField(ex));
    if (ex.type === 'bodyweight' || ex.type === 'other') put('reps', 'Reps', 'per set');
    if (fields.includes('durationSec')) put('durationSec', 'Time', ex.type === 'cardio' ? 'min' : 's per set');
    if (fields.includes('distanceKm')) put('distanceKm', 'Distance', 'km');

    // Sets × reps, collapsed: only opened when something differed from the plan.
    const setsInp = numInput(r.sets, { integer: true, 'aria-label': `${ex.name}: sets`, class: 'w-num' });
    setsInp.addEventListener('input', () => { const v = num(setsInp.value); r.sets = v > 0 ? Math.min(50, Math.round(v)) : r.sets; summary.textContent = setsLabel(); });
    const repsInp = fields.includes('reps') && ex.type === 'strength' ? numInput(r.reps, { integer: true, 'aria-label': `${ex.name}: reps per set`, class: 'w-num' }) : null;
    repsInp?.addEventListener('input', () => { const v = num(repsInp.value); r.reps = v > 0 ? Math.round(v) : null; summary.textContent = setsLabel(); });
    const summary = h('span', null, setsLabel());
    const details = h('details', { class: 'quick-sets' },
      h('summary', null, summary, h('span', { class: 'muted small' }, ' · change')),
      h('div', { class: 'field-row' }, field('Sets', setsInp), repsInp ? field('Reps per set', repsInp) : null));

    // append() skips the null branches; native card.append() would print "null".
    append(card, [
      h('div', { class: 'quick-row-head' },
        h('div', { class: 'row-main' },
          h('strong', null, ex.name),
          h('span', { class: 'muted small' }, lp ? `Last (${fmtDateShort(lp.date)}): ${fmtSetsCompact(lp.sets, ex.type, ex)}` : 'First time')),
        h('div', { class: 'row-actions' },
          btn(r.skipped ? 'Skipped' : 'Skip', () => { r.skipped = !r.skipped; draw(); }, { size: 'sm', variant: r.skipped ? 'primary' : 'ghost', pressed: r.skipped, ariaLabel: `${r.skipped ? 'Undo skip' : 'Skip'} ${ex.name}` }),
          iconBtn('swap', `Change ${ex.name} to another exercise`, async () => {
            const next = await pickExercise({ title: `Instead of ${ex.name}`, suggestedIds: ex.alternativeIds || [], suggestedLabel: 'Alternatives' });
            if (next) { rows[i] = { ...W.quickRowDefaults(next, null, last(next.id)), templateItemId: r.templateItemId, sets: r.sets }; draw(); }
          }),
          r.templateItemId ? null : iconBtn('trash', `Remove ${ex.name}`, () => { rows.splice(i, 1); draw(); }))),
      r.skipped ? h('p', { class: 'muted small' }, 'Not done this time.') : h('div', { class: 'quick-fields' }, inputs),
      r.skipped ? null : details]);
    return card;
  }

  draw();
  el.append(btn('Add exercise', async () => {
    const ex = await pickExercise({ title: 'Add exercise' });
    if (!ex) return;
    rows.push(W.quickRowDefaults(ex, null, last(ex.id)));
    draw();
    list.lastElementChild?.querySelector('input')?.focus();
  }, { icon: 'plus', block: true }));
  el.append(field('Notes', notes));

  el.append(h('div', { class: 'quick-save' }, btn('Save workout', async () => {
    const startedAt = parseLocalDate(when.value);
    const fail = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center' }); };
    if (!startedAt) return fail('Enter a valid date and time.');
    const active = rows.filter((r) => !r.skipped);
    if (!active.length) return fail('Add at least one exercise you did, or un-skip one.');
    const missing = active.filter((r) => {
      const ex = exMap.get(r.exerciseId);
      if (ex.type === 'strength') return !Number.isFinite(r.weightKg) || !Number.isFinite(r.reps);
      if (ex.type === 'bodyweight') return !Number.isFinite(r.reps);
      if (ex.type === 'timed' || ex.type === 'cardio') return !Number.isFinite(r.durationSec) && !Number.isFinite(r.distanceKm);
      return false;
    }).map((r) => exMap.get(r.exerciseId).name);
    if (missing.length) return fail(`Fill in ${missing.join(', ')} (or mark ${missing.length === 1 ? 'it' : 'them'} as skipped).`);
    const m = num(mins.value);
    err.hidden = true;
    const session = W.buildQuickSession({
      template, program: template ? store.programById(template.programId) : null, exercisesById: exMap,
      rows, startedAt, durationMin: m, notes: notes.value.trim(),
    });
    await store.saveSession(session);
    navigate(`#/history/${session.id}?done=1`);
  }, { variant: 'primary', size: 'lg', block: true, icon: 'check' })));

  return null;
}
