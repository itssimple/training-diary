// Log or edit a standalone activity (run, walk, cycling, …). Manual entry only.

import * as store from '../store.js';
import { h, btn, pageHead, field, input, numInput, textarea, iconBtn, toast, confirmDialog, emptyState } from '../ui.js';
import { icon } from '../icons.js';
import { navigate } from '../shell.js';
import { pickExercise } from './library.js';
import { createActivitySession } from '../workout-logic.js';
import { exerciseSnapshot, paceSecPerKm, speedKmh } from '../model.js';
import { num, fmtDuration, fmtNum, isoDateTimeLocal, parseLocalDate, uid } from '../util.js';

const isActivityType = (e) => e.isActivity || e.type === 'cardio';

export function renderActivity({ el, params }) {
  const isNew = params[0] === 'new';
  const existing = isNew ? null : store.sessionById(params[0]);
  if (!isNew && (!existing || existing.kind !== 'activity')) {
    el.append(pageHead('Activity not found', { back: '#/history' }), emptyState('This activity does not exist', null, h('a', { class: 'btn', href: '#/history' }, 'Back to history')));
    return;
  }
  const a = existing ? structuredClone(existing.activity) : {};
  // Default to the most recently logged activity type, else Running.
  const lastAct = store.completedSessions().find((s) => s.kind === 'activity');
  let exercise = existing
    ? (store.exerciseById(a.exerciseId) || { id: a.exerciseId, ...a.exercise })
    : (store.exerciseById(lastAct?.activity?.exerciseId) || store.exerciseById('ex_running') || store.exercisesSorted().find(isActivityType) || null);

  el.append(pageHead(isNew ? 'Log activity' : 'Edit activity', { back: isNew ? '#/' : `#/history/${existing.id}`, kicker: 'Activity' }));
  const form = h('form', { class: 'form narrow card', novalidate: true });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });

  const exBtn = h('button', { type: 'button', class: 'select-btn', 'aria-label': 'Activity type' });
  const drawEx = () => {
    exBtn.replaceChildren(icon('run'), h('span', null, exercise ? exercise.name : 'Choose activity'), icon('down'));
    paceRow();
  };
  exBtn.addEventListener('click', async () => {
    const picked = await pickExercise({
      title: 'Choose activity',
      suggestedIds: store.exercisesSorted().filter((e) => e.isActivity).map((e) => e.id),
      suggestedLabel: 'Activities',
      filter: (e) => isActivityType(e) || e.type === 'other' || e.type === 'timed',
    });
    if (picked) { exercise = picked; drawEx(); }
  });

  const when = input({ type: 'datetime-local', value: isoDateTimeLocal(existing ? existing.startedAt : Date.now()), max: isoDateTimeLocal(Date.now() + 86400000) });
  const dur = a.durationSec ?? null;
  const hh = numInput(dur !== null ? Math.floor(dur / 3600) : null, { integer: true, placeholder: '0', 'aria-label': 'Hours', class: 'w-num' });
  const mm = numInput(dur !== null ? Math.floor((dur % 3600) / 60) : null, { integer: true, placeholder: '0', 'aria-label': 'Minutes', class: 'w-num' });
  const ss = numInput(dur !== null ? dur % 60 : null, { integer: true, placeholder: '0', 'aria-label': 'Seconds', class: 'w-num' });
  const dist = numInput(a.distanceKm, { placeholder: 'optional' });
  const elev = numInput(a.elevationM, { integer: true, placeholder: 'optional' });
  const kcal = numInput(a.calories, { integer: true, placeholder: 'optional' });
  const avgHr = numInput(a.avgHr, { integer: true, placeholder: 'optional' });
  const maxHr = numInput(a.maxHr, { integer: true, placeholder: 'optional' });
  const notes = textarea(existing?.notes || '', { rows: 3, maxlength: 2000, placeholder: 'Route, weather, how it felt…' });
  const extra = (a.extra || []).map((x) => ({ ...x }));
  const derived = h('p', { class: 'derived', 'aria-live': 'polite' });

  const readDuration = () => {
    const vals = [hh, mm, ss].map((x) => num(x.value));
    if (vals.every((v) => v === null)) return null;
    const [H, M, S] = vals.map((v) => v || 0);
    if ([H, M, S].some((v) => v < 0) || M >= 60 || S >= 60) return NaN;
    return Math.round(H * 3600 + M * 60 + S);
  };
  function paceRow() {
    const d = readDuration();
    const km = num(dist.value);
    const showSpeed = exercise?.cardioDisplay === 'speed';
    if (Number.isFinite(d) && d > 0 && km > 0) {
      const pace = paceSecPerKm(d, km);
      const speed = speedKmh(d, km);
      derived.textContent = showSpeed ? `Average speed ${fmtNum(speed, 1)} km/h (pace ${fmtDuration(pace)} /km)` : `Average pace ${fmtDuration(pace)} /km (${fmtNum(speed, 1)} km/h)`;
    } else derived.textContent = 'Enter time and distance to see pace and speed.';
  }
  for (const x of [hh, mm, ss, dist]) x.addEventListener('input', paceRow);

  const extraEl = h('div', { class: 'meta-list' });
  const drawExtra = () => extraEl.replaceChildren(...extra.map((x, i) => h('div', { class: 'field-row' },
    input({ value: x.label, placeholder: 'Metric (e.g. Cadence)', 'aria-label': 'Metric name', oninput: (e) => { x.label = e.target.value; } }),
    input({ value: x.value, placeholder: 'Value', 'aria-label': 'Metric value', inputmode: 'decimal', oninput: (e) => { x.value = e.target.value; } }),
    input({ value: x.unit || '', placeholder: 'Unit', 'aria-label': 'Metric unit', class: 'w-num', oninput: (e) => { x.unit = e.target.value; } }),
    iconBtn('trash', 'Remove metric', () => { extra.splice(i, 1); drawExtra(); }))));
  drawExtra();

  form.append(err,
    field('Activity', exBtn),
    field('Date and time', when),
    h('fieldset', { class: 'fieldset' }, h('legend', null, 'Duration'),
      h('div', { class: 'field-row duration-row' },
        h('label', null, hh, h('span', null, 'h')), h('label', null, mm, h('span', null, 'min')), h('label', null, ss, h('span', null, 's')))),
    field('Distance', dist, { unit: 'km' }),
    derived,
    h('details', { class: 'more', open: a.elevationM || a.calories || a.avgHr || a.maxHr || extra.length ? true : null },
      h('summary', null, 'More metrics (optional)'),
      h('p', { class: 'muted small' }, 'Entered manually, e.g. from a watch or machine display. The app does not measure these.'),
      h('div', { class: 'grid-2' }, field('Elevation gain', elev, { unit: 'm' }), field('Calories', kcal, { unit: 'kcal' }), field('Average heart rate', avgHr, { unit: 'bpm' }), field('Max heart rate', maxHr, { unit: 'bpm' })),
      extraEl,
      btn('Add custom metric', () => { extra.push({ id: uid('m'), label: '', value: '', unit: '' }); drawExtra(); }, { size: 'sm', icon: 'plus' })),
    field('Notes', notes));

  const actions = h('div', { class: 'form-actions' }, btn(isNew ? 'Save activity' : 'Save changes', null, { variant: 'primary', type: 'submit', icon: 'check' }));
  if (existing) {
    actions.append(btn('Delete', async () => {
      if (await confirmDialog({ title: 'Delete activity?', message: 'This permanently removes this activity from your history.', confirmLabel: 'Delete', danger: true })) {
        await store.deleteSession(existing.id);
        toast('Activity deleted.');
        navigate('#/history', { replace: true });
      }
    }, { variant: 'danger' }));
  }
  form.append(actions);
  drawEx();

  let saving = false;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (saving) return;
    const fail = (msg, elFocus) => { err.textContent = msg; err.hidden = false; elFocus?.focus(); };
    if (!exercise) return fail('Choose an activity.', exBtn);
    const startedAt = parseLocalDate(when.value);
    if (!startedAt) return fail('Enter a valid date and time.', when);
    const durationSec = readDuration();
    if (Number.isNaN(durationSec)) return fail('Check the duration: minutes and seconds must be 0–59.', mm);
    const nums = {};
    for (const [k, inp, label] of [['distanceKm', dist, 'Distance'], ['elevationM', elev, 'Elevation'], ['calories', kcal, 'Calories'], ['avgHr', avgHr, 'Average heart rate'], ['maxHr', maxHr, 'Max heart rate']]) {
      const raw = inp.value.trim();
      const v = num(raw);
      if (raw && (v === null || v < 0)) return fail(`${label} must be a positive number.`, inp);
      nums[k] = v;
    }
    const extras = extra.filter((x) => x.label.trim()).map((x) => ({ id: x.id || uid('m'), label: x.label.trim(), value: num(x.value) ?? String(x.value || '').trim(), unit: (x.unit || '').trim() }));
    if (durationSec === null && nums.distanceKm === null && !extras.length && !notes.value.trim()) return fail('Enter at least a duration, a distance, a metric or a note.', mm);
    err.hidden = true;
    saving = true;
    try {
      const fields = { startedAt, durationSec, ...nums, extra: extras, notes: notes.value.trim() };
      let session;
      if (existing) {
        session = structuredClone(existing);
        session.startedAt = startedAt;
        session.endedAt = durationSec ? startedAt + durationSec * 1000 : startedAt;
        session.notes = fields.notes;
        session.name = exercise.name;
        session.updatedAt = Date.now();
        session.activity = { ...session.activity, exerciseId: exercise.id, exercise: exerciseSnapshot(exercise), durationSec, ...nums, extra: extras };
      } else {
        session = createActivitySession(fields, exercise);
      }
      await store.saveSession(session);
      toast(existing ? 'Activity updated.' : 'Activity saved.');
      navigate(`#/history/${session.id}`, { replace: true });
    } finally {
      saving = false;
    }
  });
  el.append(form);
}
