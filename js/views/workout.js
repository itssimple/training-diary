// Active workout screen (also used to edit a completed workout from history).

import * as store from '../store.js';
import * as W from '../workout-logic.js';
import { h, append, btn, iconBtn, numInput, textarea, input, field, toast, confirmDialog, actionSheet, openDialog, emptyState, captureFocus, clear } from '../ui.js';
import { icon } from '../icons.js';
import { onTick, navigate } from '../shell.js';
import { pickExercise } from './library.js';
import { startEmptyWorkout } from '../actions.js';
import { primeAudio, beep, vibrate, keepScreenOn } from '../device.js';
import { fieldsForType, sessionElapsedSec, sessionSummary, lastPerformance, GROUP_TYPES, newRecordsIn, fmtKg, SET_KINDS, setKind } from '../model.js';
import { fmtDuration, fmtNum, num, fmtDateShort, plural, parseDuration, isoDateTimeLocal, parseLocalDate } from '../util.js';
import { platesPerSide, warmupPlan, progressionHint, incrementFor } from '../training-aids.js';

export function renderWorkout(ctx) {
  const s = store.activeSession();
  if (!s) {
    ctx.el.append(h('header', { class: 'page-head' }, h('div', { class: 'page-title' }, h('h1', { id: 'page-title', tabindex: '-1' }, 'Workout'))),
      emptyState('No workout in progress', 'Start one from a program, or start an empty workout and add exercises as you go.',
        h('div', { class: 'quick-actions' }, h('a', { class: 'btn btn-primary', href: '#/train' }, 'Choose a workout'), btn('Empty workout', startEmptyWorkout, { icon: 'plus' })), 'train'));
    return null;
  }
  const cleanup = mountSessionEditor(ctx, s, { mode: 'active' });
  if (ctx.query.add) {
    // Coming from "Empty workout": open the picker straight away.
    history.replaceState(null, '', '#/workout');
    ctx.el.querySelector('.wk-detail .btn-primary')?.click();
  }
  return cleanup;
}

// ---------- formatting helpers ----------

function fmtValue(f, v, type) {
  if (!Number.isFinite(v)) return '';
  if (f === 'weightKg') return `${fmtNum(v)} kg`;
  if (f === 'reps') return `${fmtNum(v, 0)}`;
  if (f === 'durationSec') return type === 'cardio' ? `${fmtNum(v / 60, 1)} min` : `${fmtNum(v, 0)} s`;
  if (f === 'distanceKm') return `${fmtNum(v)} km`;
  return String(v);
}

/**
 * "10 × 40 kg", "8–12 × 22 kg/hand", "6 × 20 kg assist", "45 s", "10 min · 2 km", "… @ RPE 8".
 * snap: the exercise snapshot (weight mode / lower-is-better).
 */
export function fmtSetValues(values, type, snap = null) {
  if (!values) return '';
  const fields = fieldsForType(type);
  const parts = [];
  const reps = Number.isFinite(values.reps)
    ? (Number.isFinite(values.repsMax) && values.repsMax > values.reps ? `${fmtNum(values.reps, 0)}–${fmtNum(values.repsMax, 0)}` : fmtNum(values.reps, 0))
    : null;
  const showWeight = fields.includes('weightKg') && Number.isFinite(values.weightKg) && (values.weightKg > 0 || !!snap?.lowerIsBetter);
  const kg = showWeight ? fmtKg(values.weightKg, snap, (v) => fmtNum(v)) : '';
  if (fields.includes('reps') && reps !== null) {
    parts.push(showWeight ? `${reps} × ${kg}${type === 'bodyweight' && !snap?.lowerIsBetter ? ' added' : ''}` : `${reps} reps`);
  } else if (showWeight) parts.push(kg);
  if (fields.includes('durationSec') && Number.isFinite(values.durationSec)) parts.push(fmtValue('durationSec', values.durationSec, type));
  if (fields.includes('distanceKm') && Number.isFinite(values.distanceKm)) parts.push(fmtValue('distanceKm', values.distanceKm, type));
  let out = parts.join(' · ');
  if (out && Number.isFinite(values.rpe)) out += ` @ RPE ${fmtNum(values.rpe, 1)}`;
  if (out && Number.isFinite(values.rir)) out += ` (${fmtNum(values.rir, 0)} RIR)`;
  return out;
}

export function fmtSetsCompact(sets, type, snap = null) {
  if (!sets?.length) return '';
  const strs = sets.map((v) => fmtSetValues(v, type, snap)).filter(Boolean);
  // Collapse identical consecutive sets: "3 × (10 × 40 kg)"
  if (strs.length > 1 && strs.every((x) => x === strs[0])) return `${strs.length} sets: ${strs[0]}`;
  return strs.join(', ');
}

const FIELD_LABEL = { weightKg: 'kg', reps: 'reps', durationSec: 'time', distanceKm: 'km' };

function toInputValue(f, v, type) {
  if (!Number.isFinite(v)) return null;
  if (f === 'durationSec' && type === 'cardio') return Math.round((v / 60) * 10) / 10;
  return v;
}

function fromInputValue(f, raw, type) {
  if (f === 'durationSec') {
    if (type === 'cardio') {
      const sec = parseDuration(raw); // minutes or mm:ss
      return sec === null ? null : sec;
    }
    const s = String(raw).includes(':') ? parseDuration(raw) : num(raw);
    return s === null ? null : Math.max(0, Math.round(s));
  }
  const n = num(raw);
  if (n === null || n < 0) return null;
  return f === 'reps' ? Math.round(n) : n;
}

const REQUIRED = { strength: ['reps'], bodyweight: ['reps'], timed: ['durationSec'], cardio: ['durationSec'], other: [] };

/** Column label for the weight input: kg, kg/hand, +kg (bodyweight) or assist kg. */
function weightLabel(snap, type) {
  if (snap?.lowerIsBetter) return 'assist kg';
  if (snap?.weightMode === 'perHand') return 'kg/hand';
  return type === 'bodyweight' ? '+kg' : 'kg';
}

const RPE_VALUES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const RIR_VALUES = [0, 1, 2, 3, 4, 5];

// ---------- main editor ----------

export function mountSessionEditor({ el }, session, { mode = 'active' } = {}) {
  const editMode = mode === 'edit';
  const settings = store.state.settings;
  const defaultRest = settings.defaultRestSec ?? 90;
  const lastCache = new Map();
  const lastPerf = (exId) => {
    if (!lastCache.has(exId)) lastCache.set(exId, lastPerformance(store.state.sessions, exId, session.id));
    return lastCache.get(exId);
  };
  let saveTimer = null;
  const saveNow = async () => { clearTimeout(saveTimer); saveTimer = null; await store.saveSession(session); };
  const saveSoon = () => { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 300); };

  if (!session.focusEntryId || !W.findEntry(session, session.focusEntryId)) {
    session.focusEntryId = session.entries.find((e) => !W.isEntryFinished(e))?.id || session.entries[0]?.id || null;
  }

  const refs = {};

  function draw() {
    const restore = captureFocus(el);
    clear(el);
    el.classList.add('workout-view');
    el.append(header());
    if (!editMode && session.pausedAt) el.append(pausedBanner());
    const layout = h('div', { class: 'workout-layout' });
    const units = W.groupUnits(session);
    const focusUnit = units.find((u) => u.entries.some((e) => e.id === session.focusEntryId)) || units[0];
    layout.append(
      h('div', { class: 'wk-detail' }, focusUnit ? unitCard(focusUnit, units) : emptyState('No exercises yet', 'Add an exercise to start recording sets.', btn('Add exercise', addExercise, { variant: 'primary', icon: 'plus' }), 'train')),
      overview(units, focusUnit));
    el.append(layout);
    if (!editMode) el.append(restDock());
    restore();
    updateTimers();
  }

  // ----- header -----

  function header() {
    const sum = sessionSummary(session);
    refs.elapsed = h('span', { class: 'mono big-timer', 'aria-label': 'Workout duration' }, fmtDuration(sessionElapsedSec(session)));
    const actions = editMode
      ? [btn('Date & time', editDateTime, { variant: 'secondary', icon: 'calendar' }), h('a', { class: 'btn btn-primary', href: `#/history/${session.id}` }, icon('check'), h('span', null, 'Done editing'))]
      : [
        session.pausedAt
          ? btn('Resume', resume, { variant: 'primary', icon: 'play' })
          : iconBtn('pause', 'Pause workout', pause, { variant: 'secondary' }),
        iconBtn('more', 'Workout options', workoutMenu, { variant: 'secondary' }),
      ];
    return h('header', { class: 'page-head wk-head' },
      h('div', { class: 'page-title' },
        h('p', { class: 'kicker' }, editMode ? 'Editing recorded workout' : (session.programName ? session.programName : 'Workout')),
        h('h1', { id: 'page-title', tabindex: '-1' }, session.name)),
      h('div', { class: 'page-actions' }, actions),
      h('div', { class: 'wk-stats' },
        editMode ? h('span', null, `${fmtDateShort(session.startedAt)} · ${fmtDuration(sessionElapsedSec(session))}`) : refs.elapsed,
        h('span', null, h('strong', null, `${sum.setsDone}`), ` / ${sum.setsPlanned} sets`),
        sum.volumeKg ? h('span', { title: 'Volume (weight × reps)' }, h('strong', null, fmtNum(Math.round(sum.volumeKg), 0)), ' kg') : null,
        !editMode ? btn('Finish', finish, { variant: 'primary', size: 'sm', icon: 'flag', class: 'finish-btn' }) : null));
  }

  function pausedBanner() {
    return h('div', { class: 'paused-banner', role: 'status' }, icon('pause'),
      h('span', null, 'Workout paused. The workout timer and rest timer are stopped.'),
      btn('Resume', resume, { variant: 'primary', size: 'sm', icon: 'play' }));
  }

  // ----- overview list -----

  function overview(units, focusUnit) {
    const list = h('ol', { class: 'wk-overview-list' });
    units.forEach((u) => {
      const rows = u.entries.map((e) => {
        const p = W.entryProgress(e);
        const state = e.status === 'skipped' ? 'skipped' : e.status === 'done' ? 'done' : (p.done ? 'partial' : 'pending');
        const stateLabel = { skipped: 'Skipped', done: 'Done', partial: 'In progress', pending: 'Not started' }[state];
        return h('li', { class: ['ov-row', `st-${state}`, e.id === session.focusEntryId ? 'current' : ''] },
          h('button', { type: 'button', class: 'ov-btn', 'aria-current': u === focusUnit ? 'step' : null, onclick: () => focusEntry(e.id, true) },
            h('span', { class: 'ov-status', 'aria-hidden': 'true' }, state === 'done' ? icon('check') : state === 'skipped' ? icon('skip') : null),
            h('span', { class: 'row-main' },
              h('strong', null, e.exercise?.name || 'Exercise'),
              h('span', { class: 'muted small' }, `${stateLabel} · ${p.done}/${p.total} sets${e.substitution ? ' · swapped' : ''}${e.adHoc ? ' · added' : ''}`))));
      });
      if (u.groupId) {
        list.append(h('li', { class: 'ov-group' }, h('span', { class: 'group-tag small' }, icon('link'), GROUP_TYPES[u.group?.type] || 'Superset'), h('ol', null, rows)));
      } else list.append(...rows);
    });
    return h('aside', { class: 'wk-overview card', 'aria-label': 'Workout overview' },
      h('div', { class: 'card-head' }, h('h2', null, 'Exercises'), h('span', { class: 'muted small' }, plural(session.entries.length, 'exercise'))),
      list,
      btn('Add exercise', addExercise, { icon: 'plus', block: true }),
      !editMode ? h('div', { class: 'wk-overview-foot' },
        btn('Finish workout', finish, { variant: 'primary', block: true, icon: 'flag' }),
        btn('Discard workout', discard, { variant: 'ghost', block: true, class: 'danger-text' })) : null);
  }

  // ----- unit / entry cards -----

  function unitCard(unit, units) {
    const idx = units.indexOf(unit);
    const prev = units[idx - 1];
    const next = units[idx + 1];
    const isGroup = !!unit.groupId;
    let roundInfo = null;
    if (isGroup) {
      const active = unit.entries.filter((e) => e.status !== 'skipped');
      const rounds = Math.max(0, ...active.map((e) => e.sets.length));
      const doneRounds = Math.min(...active.map((e) => e.sets.filter((s) => s.done).length));
      roundInfo = `Round ${Math.min(rounds, doneRounds + 1)} of ${rounds}`;
    }
    return h('section', { class: ['card', 'unit-card', isGroup ? 'is-group' : ''], 'aria-label': isGroup ? `${GROUP_TYPES[unit.group?.type] || 'Superset'} of ${unit.entries.length} exercises` : unit.entries[0].exercise?.name },
      isGroup ? h('div', { class: 'group-head' },
        h('span', { class: 'group-tag' }, icon('link'), GROUP_TYPES[unit.group?.type] || 'Superset'),
        h('span', { class: 'muted small' }, roundInfo),
        Number.isFinite(unit.group?.restSec) ? h('span', { class: 'muted small' }, `Rest ${unit.group.restSec} s after each round`) : null) : null,
      unit.entries.map((e) => entryBlock(e, isGroup)),
      h('div', { class: 'unit-nav' },
        btn('Previous', () => focusEntry(prev.entries[0].id, true), { variant: 'ghost', icon: 'back', disabled: !prev }),
        btn(next ? 'Next exercise' : 'Last exercise', () => focusEntry(next.entries[0].id, true), { variant: 'secondary', disabled: !next, class: 'next-btn' })));
  }

  function entryBlock(e, inGroup) {
    const type = e.exercise?.type || 'strength';
    const fields = fieldsForType(type);
    const last = lastPerf(e.exerciseId);
    const p = W.entryProgress(e);
    const skipped = e.status === 'skipped';
    const current = e.id === session.focusEntryId;
    const block = h('article', { class: ['entry', skipped ? 'is-skipped' : '', e.status === 'done' ? 'is-done' : '', inGroup && current ? 'current' : ''], 'aria-labelledby': `en-${e.id}` });

    block.append(h('div', { class: 'entry-head' },
      h('div', { class: 'row-main' },
        h('h2', { id: `en-${e.id}`, class: 'entry-title' }, e.exercise?.name || 'Exercise'),
        h('p', { class: 'muted small' },
          [e.exercise?.equipment, `${p.done}/${p.total} sets`, skipped ? 'Skipped' : e.status === 'done' ? 'Complete' : null].filter(Boolean).join(' · '))),
      h('div', { class: 'row-actions' },
        btn('Swap', () => swap(e), { variant: 'secondary', size: 'sm', icon: 'swap', ariaLabel: `Swap ${e.exercise?.name}` }),
        iconBtn('more', `More actions for ${e.exercise?.name}`, () => entryMenu(e), { variant: 'secondary' }))));

    if (e.substitution) {
      block.append(h('p', { class: 'swap-note small' }, icon('swap'),
        h('span', null, `Replaces planned ${e.plannedExercise?.name || e.substitution.fromName || 'exercise'}`,
          e.substitution.note ? ` — “${e.substitution.note}”` : '',
          '. Plan values refer to the planned exercise, so weight is not pre-filled.')));
    }
    block.append(h('p', { class: 'last-time small' }, icon('history'),
      last ? h('span', null, h('span', { class: 'muted' }, `Last time (${fmtDateShort(last.date)}): `), fmtSetsCompact(last.sets, type, e.exercise) || '—')
        : h('span', { class: 'muted' }, 'First time recording this exercise.')));
    const hint = settings.progressionHints && !editMode && e.status !== 'done' ? progressionHint(e, last, incrementFor(store.exerciseById(e.exerciseId) || e.exercise)) : null;
    if (hint) block.append(hintCard(e, hint));
    if (e.planNotes) block.append(h('p', { class: 'plan-notes small' }, icon('note'), h('span', null, e.planNotes)));

    if (skipped) {
      block.append(h('div', { class: 'skipped-msg' }, h('p', null, 'Skipped. Planned sets are kept in the record as not performed.'),
        btn('Undo skip', async () => { W.unskipEntry(session, e.id); await saveNow(); draw(); }, { size: 'sm' })));
      return block;
    }

    // Sets table
    const effort = settings.effortMode !== 'off' && ['strength', 'bodyweight'].includes(type) ? settings.effortMode : null;
    const table = h('div', { class: ['sets', effort ? 'has-effort' : ''], role: 'table', 'aria-label': `Sets for ${e.exercise?.name}` });
    table.style.setProperty('--cols', String(fields.length + (effort ? 1 : 0)));
    table.append(h('div', { class: 'set-row set-head', role: 'row' },
      h('span', { role: 'columnheader' }, 'Set'),
      h('span', { role: 'columnheader', class: 'col-plan' }, 'Plan'),
      fields.map((f) => h('span', { role: 'columnheader' }, f === 'weightKg' ? weightLabel(e.exercise, type) : f === 'durationSec' ? (type === 'cardio' ? 'min' : 'sec') : FIELD_LABEL[f])),
      effort ? h('span', { role: 'columnheader' }, effort.toUpperCase()) : null,
      h('span', { role: 'columnheader', class: 'sr-only' }, 'Done')));
    e.sets.forEach((set, i) => table.append(setRow(e, set, i, type, fields, last, effort)));
    block.append(table);
    block.append(h('div', { class: 'entry-foot' },
      btn('Add set', async () => { W.addSet(session, e.id); await saveNow(); draw(); }, { variant: 'ghost', size: 'sm', icon: 'plus' }),
      e.notes ? null : btn('Note', () => editEntryNote(e), { variant: 'ghost', size: 'sm', icon: 'note' }),
      isBarbell(e) ? btn('Plates', () => plateCalculator(e), { variant: 'ghost', size: 'sm', icon: 'calc' }) : null));
    if (e.notes) block.append(h('button', { type: 'button', class: 'entry-note small', onclick: () => editEntryNote(e) }, icon('note'), h('span', null, e.notes)));
    return block;
  }

  function setRow(e, set, i, type, fields, last, effort) {
    const sug = W.suggestSetValues(e, i, last);
    const kind = setKind(set);
    const row = h('div', { class: ['set-row', set.done ? 'done' : '', `kind-${kind}`], role: 'row' });
    const kindLabel = kind === 'working' ? '' : `, ${SET_KINDS[kind].label}`;
    row.append(h('span', { role: 'cell' },
      h('button', { type: 'button', class: 'set-no', 'aria-label': `Set ${i + 1}${kindLabel} options`, onclick: () => setMenu(e, set, i) }, SET_KINDS[kind].short || String(workingNumber(e, i)), set.note ? h('span', { class: 'dot-note', 'aria-label': 'has note' }) : null)));
    row.append(h('span', { role: 'cell', class: 'col-plan muted small' }, set.planned ? fmtSetValues(set.planned, type, e.exercise) || '—' : '—'));
    for (const f of fields) {
      const cur = set.actual?.[f];
      const ph = Number.isFinite(sug.values[f]) ? fmtNum(toInputValue(f, sug.values[f], type), 2) : '';
      const inp = numInput(toInputValue(f, cur, type), {
        integer: f === 'reps',
        placeholder: ph,
        class: ['set-input', sug.source[f] ? `from-${sug.source[f]}` : ''].join(' '),
        'aria-label': `Set ${i + 1} ${f === 'durationSec' ? (type === 'cardio' ? 'minutes' : 'seconds') : FIELD_LABEL[f]}${ph ? `, suggested ${ph}` : ''}`,
        dataset: { focus: `${set.id}:${f}` },
      });
      inp.addEventListener('input', () => { W.setActual(session, e.id, set.id, { [f]: fromInputValue(f, inp.value, type) }); saveSoon(); });
      inp.addEventListener('change', () => { saveNow(); });
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); toggleSet(e, set, i, sug); } });
      row.append(h('span', { role: 'cell' }, inp));
    }
    if (effort) row.append(h('span', { role: 'cell' }, effortSelect(e, set, i, effort)));
    row.append(h('span', { role: 'cell' },
      h('button', {
        type: 'button', class: ['check-btn', set.done ? 'on' : ''], 'aria-pressed': String(set.done),
        'aria-label': set.done ? `Set ${i + 1} done. Tap to undo` : `Mark set ${i + 1} done`,
        dataset: { focus: `${set.id}:check` },
        onclick: () => toggleSet(e, set, i, sug),
      }, icon('check'))));
    return row;
  }

  async function toggleSet(e, set, i, sug) {
    primeAudio();
    if (set.done) {
      W.uncompleteSet(session, e.id, set.id);
      await saveNow();
      draw();
      return;
    }
    const type = e.exercise?.type || 'strength';
    const merged = { ...sug.values, ...(set.actual || {}) };
    const missing = (REQUIRED[type] || []).filter((f) => !Number.isFinite(merged[f]));
    if (missing.length) {
      toast(`Enter ${missing.map((f) => (f === 'durationSec' ? 'the time' : f)).join(' and ')} for set ${i + 1} first.`);
      el.querySelector(`[data-focus="${set.id}:${missing[0]}"]`)?.focus();
      return;
    }
    const next = W.completeSet(session, e.id, set.id, defaultRest, Date.now(), sug.values);
    if (!editMode) {
      const workoutDone = session.entries.every((x) => W.isEntryFinished(x));
      if (next?.restSec > 0 && !workoutDone) W.startRest(session, next.restSec, next.nextEntryId);
      else if (next?.restSec === 0) W.clearRest(session);
      if (next?.nextEntryId) session.focusEntryId = next.nextEntryId;
      if (workoutDone) toast('All exercises done. Tap Finish when you are ready.', { action: { label: 'Finish', run: finish } });
    }
    await saveNow();
    const prevUnitKey = W.unitForEntry(session, e.id)?.key;
    draw();
    const nowUnitKey = W.unitForEntry(session, session.focusEntryId)?.key;
    if (prevUnitKey !== nowUnitKey) scrollToDetail();
    // Keep keyboard users on the next pending input.
    const nextInput = el.querySelector('.wk-detail .entry.current .set-row:not(.done) .set-input, .wk-detail .set-row:not(.done) .set-input');
    if (document.activeElement === document.body && nextInput && !matchMedia('(pointer: coarse)').matches) nextInput.focus({ preventScroll: true });
  }

  function scrollToDetail() {
    const d = el.querySelector('.wk-detail');
    if (d && d.getBoundingClientRect().top < 0) d.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  function focusEntry(id, scroll) {
    session.focusEntryId = id;
    saveSoon();
    draw();
    if (scroll) scrollToDetail();
  }

  // ----- training aids -----

  const isBarbell = (e) => e.exercise?.equipment === 'Barbell' && e.exercise?.type === 'strength';

  /** Working sets are numbered 1, 2, 3…; warm-ups show "W" instead. */
  function workingNumber(e, i) {
    return e.sets.slice(0, i + 1).filter((s) => setKind(s) !== 'warmup').length;
  }

  function effortSelect(e, set, i, mode) {
    const values = mode === 'rpe' ? RPE_VALUES : RIR_VALUES;
    const cur = set.actual?.[mode];
    const sel = h('select', {
      class: 'effort-select',
      'aria-label': `Set ${i + 1} ${mode === 'rpe' ? 'RPE (rate of perceived exertion, 6–10)' : 'reps in reserve'}`,
      dataset: { focus: `${set.id}:${mode}` },
    },
    h('option', { value: '' }, '–'),
    values.map((v) => h('option', { value: String(v), selected: cur === v }, mode === 'rir' && v === 5 ? '5+' : String(v))));
    sel.addEventListener('change', async () => {
      W.setActual(session, e.id, set.id, { [mode]: sel.value === '' ? null : Number(sel.value) });
      await saveNow();
    });
    return sel;
  }

  function hintCard(e, hint) {
    const snap = e.exercise;
    const kg = (v) => fmtKg(v, snap, (x) => fmtNum(x));
    const pending = e.sets.filter((s) => !s.done && setKind(s) !== 'warmup');
    return h('div', { class: 'hint-card small', role: 'note' }, icon('progress'),
      h('div', null,
        h('p', null, `Last time every set reached ${hint.topReps} reps at ${kg(hint.fromKg)}. `,
          hint.lowerIsBetter ? `Consider less assistance: ${kg(hint.toKg)}.` : `Consider ${kg(hint.toKg)}.`),
        pending.length ? btn(`Plan ${kg(hint.toKg)} for remaining sets`, async () => {
          for (const s of pending) W.setPlanned(session, e.id, s.id, { weightKg: hint.toKg });
          await saveNow();
          draw();
          toast('Plan updated for this workout. The template is unchanged.');
        }, { size: 'sm', variant: 'secondary' }) : null));
  }

  function firstWorkingWeight(e) {
    const idx = e.sets.findIndex((s) => setKind(s) !== 'warmup' && !s.done);
    if (idx < 0) return null;
    const s = e.sets[idx];
    return s.actual?.weightKg ?? W.suggestSetValues(e, idx, lastPerf(e.exerciseId)).values.weightKg ?? null;
  }

  async function addWarmups(e) {
    const st = store.state.settings;
    const inp = numInput(firstWorkingWeight(e), { autofocus: true });
    const res = await openDialog({
      title: `Warm-up · ${e.exercise?.name}`, sheet: false,
      build: (close) => h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); close(num(inp.value)); } },
        field('First working weight', inp, { unit: weightLabel(e.exercise, e.exercise?.type) }),
        h('p', { class: 'muted small' }, 'Adds lighter sets before your working sets. Warm-ups are not counted in volume, set counts or records.'),
        h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Add warm-up sets', null, { variant: 'primary', type: 'submit' }))),
    });
    if (!Number.isFinite(res)) return;
    const plan = warmupPlan(res, { barbell: isBarbell(e), barKg: st.barWeightKg || 20, stepKg: e.exercise?.weightMode === 'perHand' ? 2 : 2.5 });
    if (!plan.length) { toast('That weight is light enough to start without warm-up sets.'); return; }
    W.addWarmupSets(session, e.id, plan);
    await saveNow();
    draw();
    toast(`Added ${plural(plan.length, 'warm-up set')}.`);
  }

  async function plateCalculator(e, set = null) {
    const st = store.state.settings;
    const start = set?.actual?.weightKg ?? set?.planned?.weightKg ?? firstWorkingWeight(e) ?? null;
    const total = numInput(start, { autofocus: true });
    const bar = numInput(st.barWeightKg ?? 20);
    const out = h('div', { class: 'plates-out', 'aria-live': 'polite' });
    const show = () => {
      const t = num(total.value);
      const b = num(bar.value) ?? 20;
      const r = platesPerSide(t, b, st.platesKg);
      out.replaceChildren();
      if (!Number.isFinite(t)) { out.append(h('p', { class: 'muted' }, 'Enter a total weight.')); return; }
      if (r.belowBar) { out.append(h('p', null, `That is less than the bar (${fmtNum(b)} kg).`)); return; }
      append(out, [
        h('p', { class: 'muted small' }, 'On each side of the bar:'),
        r.perSide.length
          ? h('div', { class: 'plate-stack', 'aria-hidden': 'true' }, r.perSide.flatMap((p) => Array.from({ length: p.count }, () => h('span', { class: 'plate', style: { height: `${28 + Math.min(52, p.plateKg * 2)}px` } }, fmtNum(p.plateKg)))))
          : null,
        h('p', null, h('strong', null, r.perSide.map((p) => `${p.count} × ${fmtNum(p.plateKg)} kg`).join(' + ') || 'Empty bar')),
        r.remainderKg ? h('p', { class: 'notice small' }, icon('warn'), h('span', null, `Closest with your plates: ${fmtNum(r.loadedKg)} kg (${fmtNum(Math.abs(r.remainderKg))} kg ${r.remainderKg > 0 ? 'short' : 'over'}).`)) : null]);
    };
    total.addEventListener('input', show);
    bar.addEventListener('input', show);
    show();
    await openDialog({
      title: 'Plate calculator', sheet: false,
      build: (close) => h('div', { class: 'form' },
        h('div', { class: 'grid-2' }, field('Total weight', total, { unit: 'kg' }), field('Bar', bar, { unit: 'kg' })),
        out,
        h('p', { class: 'muted small' }, `Plates: ${st.platesKg.map((p) => fmtNum(p)).join(', ')} kg. Change them in Settings.`),
        h('div', { class: 'dialog-actions' }, btn('Close', () => close(), { variant: 'primary' }))),
    });
  }

  async function editDateTime() {
    const when = input({ type: 'datetime-local', value: isoDateTimeLocal(session.startedAt), max: isoDateTimeLocal(Date.now()), autofocus: true });
    const mins = numInput(Math.round(sessionElapsedSec(session) / 60), { integer: true });
    const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const res = await openDialog({
      title: 'Date and duration', sheet: false,
      build: (close) => h('form', {
        class: 'form', onsubmit: (ev) => {
          ev.preventDefault();
          const t = parseLocalDate(when.value);
          const m = num(mins.value);
          if (!t) { err.textContent = 'Enter a valid date and time.'; err.hidden = false; return; }
          if (m === null || m < 0 || m > 24 * 60) { err.textContent = 'Duration must be 0–1440 minutes.'; err.hidden = false; return; }
          close({ t, m });
        },
      }, err, field('Started', when), field('Duration', mins, { unit: 'minutes' }),
      h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Save', null, { variant: 'primary', type: 'submit' }))),
    });
    if (!res) return;
    session.startedAt = res.t;
    session.endedAt = res.t + Math.round(res.m) * 60000;
    session.pausedMs = 0;
    session.updatedAt = Date.now();
    await saveNow();
    draw();
    toast('Date and duration updated.');
  }

  // ----- menus & dialogs -----

  function setMenu(e, set, i) {
    const kind = setKind(set);
    actionSheet(`Set ${i + 1} · ${e.exercise?.name}`, [
      ...Object.entries(SET_KINDS).map(([k, v]) => ({
        label: k === kind ? `${v.label} (current)` : `Mark as ${v.label.toLowerCase()}`, icon: k === kind ? 'check' : 'edit', hidden: k === kind,
        hint: k === 'warmup' ? 'Not counted in volume, sets or records' : null,
        run: async () => { W.setSetKind(session, e.id, set.id, k); await saveNow(); draw(); },
      })),
      { label: 'Plate calculator', icon: 'calc', hidden: !isBarbell(e), run: () => plateCalculator(e, set) },
      { label: 'Edit plan for this set', icon: 'edit', run: () => editPlan(e, set, i) },
      { label: set.note ? 'Edit set note' : 'Add set note', icon: 'note', run: () => editSetNote(e, set, i) },
      { label: 'Mark not done', icon: 'reset', hidden: !set.done, run: async () => { W.uncompleteSet(session, e.id, set.id); await saveNow(); draw(); } },
      { label: 'Clear actual values', icon: 'x', hidden: !set.actual, run: async () => { set.actual = null; set.done = false; set.doneAt = null; W.uncompleteSet(session, e.id, set.id); await saveNow(); draw(); } },
      { label: 'Remove set', icon: 'trash', danger: true, run: async () => { W.removeSet(session, e.id, set.id); await saveNow(); draw(); } },
    ]);
  }

  async function editPlan(e, set, i) {
    const type = e.exercise?.type || 'strength';
    const fields = fieldsForType(type);
    const inputs = {};
    const res = await openDialog({
      title: `Plan for set ${i + 1}`,
      sheet: false,
      build: (close) => h('form', {
        class: 'form', onsubmit: (ev) => {
          ev.preventDefault();
          const out = {};
          for (const f of fields) out[f] = fromInputValue(f, inputs[f].value, type);
          if (inputs.repsMax) out.repsMax = fromInputValue('reps', inputs.repsMax.value, type);
          close(out);
        },
      },
      h('p', { class: 'muted small' }, 'Changes the plan for this workout only. The template is not changed.'),
      h('div', { class: 'grid-2' }, fields.map((f) => {
        inputs[f] = numInput(toInputValue(f, set.planned?.[f], type), { integer: f === 'reps' });
        return field(f === 'durationSec' ? 'Time' : f === 'weightKg' ? 'Weight' : f === 'reps' ? 'Reps (min)' : 'Distance', inputs[f], { unit: f === 'durationSec' ? (type === 'cardio' ? 'min' : 's') : f === 'weightKg' ? weightLabel(e.exercise, type) : f === 'distanceKm' ? 'km' : null });
      }), fields.includes('reps') ? field('Reps (max, optional)', inputs.repsMax = numInput(set.planned?.repsMax, { integer: true, placeholder: 'no range' }), { hint: 'For a range like 8–12.' }) : null),
      h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Save plan', null, { variant: 'primary', type: 'submit' }))),
    });
    if (!res) return;
    W.setPlanned(session, e.id, set.id, res);
    await saveNow();
    draw();
  }

  async function textDialog(title, value, placeholder) {
    const ta = textarea(value, { rows: 4, maxlength: 2000, placeholder, autofocus: true });
    return openDialog({
      title, sheet: false,
      build: (close) => h('div', { class: 'form' }, ta,
        h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Save', () => close(ta.value.trim()), { variant: 'primary' }))),
    });
  }

  async function editSetNote(e, set, i) {
    const v = await textDialog(`Note for set ${i + 1}`, set.note, 'e.g. felt easy, grip slipped');
    if (v === undefined) return;
    W.setSetNote(session, e.id, set.id, v);
    await saveNow();
    draw();
  }

  async function editEntryNote(e) {
    const v = await textDialog(`Notes · ${e.exercise?.name}`, e.notes, 'How it went, settings used…');
    if (v === undefined) return;
    e.notes = v;
    await saveNow();
    draw();
  }

  async function editRest(e) {
    const inp = numInput(e.restSec ?? '', { integer: true, placeholder: String(defaultRest), autofocus: true });
    const v = await openDialog({
      title: `Rest · ${e.exercise?.name}`, sheet: false,
      build: (close) => h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); close(inp.value); } },
        field('Rest between sets', inp, { unit: 'seconds', hint: `Empty uses the default (${defaultRest} s). Applies to this workout only.` }),
        h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Save', null, { variant: 'primary', type: 'submit' }))),
    });
    if (v === undefined) return;
    const n = num(v);
    e.restSec = n === null ? null : Math.max(0, Math.min(3600, Math.round(n)));
    await saveNow();
    draw();
  }

  function entryMenu(e) {
    const unit = W.unitForEntry(session, e.id);
    const units = W.groupUnits(session);
    const ui = units.indexOf(units.find((u) => u.key === unit?.key));
    actionSheet(e.exercise?.name || 'Exercise', [
      { label: 'Skip exercise', icon: 'skip', hidden: e.status === 'skipped', run: async () => { W.skipEntry(session, e.id); if (session.focusEntryId === e.id) { const n = W.nextPendingEntryId(session, e.id); if (n) session.focusEntryId = n; } await saveNow(); draw(); } },
      { label: 'Undo skip', icon: 'reset', hidden: e.status !== 'skipped', run: async () => { W.unskipEntry(session, e.id); await saveNow(); draw(); } },
      { label: 'Mark exercise complete', icon: 'check', hidden: e.status !== 'pending', hint: 'Unticked sets are kept as not performed', run: async () => { W.markEntryDone(session, e.id); const n = W.nextPendingEntryId(session, e.id); if (n) session.focusEntryId = n; await saveNow(); draw(); } },
      { label: 'Reopen exercise', icon: 'reset', hidden: e.status !== 'done' || e.sets.every((s) => s.done), run: async () => { W.reopenEntry(session, e.id); await saveNow(); draw(); } },
      { label: e.notes ? 'Edit notes' : 'Add notes', icon: 'note', run: () => editEntryNote(e) },
      { label: `Rest time (${Number.isFinite(e.restSec) ? e.restSec : defaultRest} s)`, icon: 'timer', run: () => editRest(e) },
      { label: 'Add warm-up sets', icon: 'plus', hidden: !['strength'].includes(e.exercise?.type) || e.exercise?.lowerIsBetter, hint: 'Ramp up to your first working weight', run: () => addWarmups(e) },
      { label: 'Plate calculator', icon: 'calc', hidden: !isBarbell(e), run: () => plateCalculator(e) },
      { label: 'Move up', icon: 'up', hidden: unit?.groupId ? session.entries[session.entries.indexOf(e) - 1]?.groupId !== e.groupId : ui <= 0, run: async () => { W.moveEntry(session, e.id, -1); await saveNow(); draw(); } },
      { label: 'Move down', icon: 'down', hidden: unit?.groupId ? session.entries[session.entries.indexOf(e) + 1]?.groupId !== e.groupId : ui >= units.length - 1, run: async () => { W.moveEntry(session, e.id, 1); await saveNow(); draw(); } },
      { label: 'Superset with next exercise', icon: 'link', hidden: ui >= units.length - 1 || !!unit?.groupId, run: async () => { W.linkWithNext(session, e.id, 'superset'); await saveNow(); draw(); } },
      { label: 'Add next exercise to this group', icon: 'link', hidden: !unit?.groupId || ui >= units.length - 1 || unit.entries[unit.entries.length - 1].id !== e.id, run: async () => { W.linkWithNext(session, e.id); await saveNow(); draw(); } },
      { label: 'Remove from superset/circuit', icon: 'unlink', hidden: !unit?.groupId, run: async () => { W.unlinkEntry(session, e.id); await saveNow(); draw(); } },
      { label: 'Add exercise after this', icon: 'plus', run: () => addExercise(e.id) },
      {
        label: 'Remove from workout', icon: 'trash', danger: true,
        run: async () => {
          const doneCount = e.sets.filter((s) => s.done).length;
          if (doneCount && !(await confirmDialog({ title: 'Remove exercise?', message: `${e.exercise?.name} has ${plural(doneCount, 'completed set')}. Remove it and its sets from this workout?`, confirmLabel: 'Remove', danger: true }))) return;
          const snapshot = structuredClone(session.entries);
          const groups = structuredClone(session.groups);
          W.removeEntry(session, e.id);
          await saveNow();
          draw();
          toast(`Removed ${e.exercise?.name}.`, { action: { label: 'Undo', run: async () => { session.entries = snapshot; session.groups = groups; await saveNow(); draw(); } } });
        },
      },
    ]);
  }

  async function swap(e) {
    const planned = e.plannedExerciseId ? store.exerciseById(e.plannedExerciseId) : null;
    const current = store.exerciseById(e.exerciseId);
    const sugg = [...new Set([
      ...(e.plannedExerciseId && e.substitution ? [e.plannedExerciseId] : []),
      ...(e.alternativeIds || []),
      ...(planned?.alternativeIds || []),
      ...(current?.alternativeIds || []),
    ])].filter((id) => id !== e.exerciseId);
    const ex = await pickExercise({ title: `Swap ${e.exercise?.name}`, suggestedIds: sugg, suggestedLabel: 'Suggested alternatives', excludeIds: [e.exerciseId] });
    if (!ex) return;
    const hadDone = e.sets.some((s) => s.done);
    const target = W.substituteEntry(session, e.id, ex, '');
    session.focusEntryId = target.id;
    lastCache.delete(ex.id);
    await saveNow();
    draw();
    toast(hadDone ? `Done sets stay with ${e.exercise?.name}; remaining sets moved to ${ex.name}.` : `Swapped to ${ex.name}.`, {
      action: target.substitution ? { label: 'Add reason', run: async () => {
        const note = await textDialog('Why the swap?', target.substitution.note, 'e.g. machine occupied');
        if (note === undefined) return;
        target.substitution.note = note;
        await saveNow();
        draw();
      } } : null,
    });
  }

  async function addExercise(afterEntryId = null) {
    const ex = await pickExercise({ title: 'Add exercise to this workout' });
    if (!ex) return;
    const sets = ex.type === 'cardio' ? 1 : 3;
    const entry = W.addEntry(session, ex, { sets, afterEntryId: typeof afterEntryId === 'string' ? afterEntryId : null });
    session.focusEntryId = entry.id;
    await saveNow();
    draw();
    scrollToDetail();
    toast(`Added ${ex.name} to this workout only. Your template is unchanged.`);
  }

  function workoutMenu() {
    actionSheet('Workout options', [
      { label: 'Rename workout', icon: 'edit', run: renameWorkout },
      { label: session.notes ? 'Edit workout notes' : 'Add workout notes', icon: 'note', run: async () => { const v = await textDialog('Workout notes', session.notes, 'Energy, sleep, anything worth remembering'); if (v !== undefined) { session.notes = v; await saveNow(); draw(); } } },
      { label: 'Add exercise', icon: 'plus', run: () => addExercise() },
      { label: 'Finish workout', icon: 'flag', run: finish },
      { label: 'Discard workout', icon: 'trash', danger: true, run: discard },
    ]);
  }

  async function renameWorkout() {
    const inp = input({ value: session.name, maxlength: 80, autofocus: true });
    const v = await openDialog({
      title: 'Rename workout', sheet: false,
      build: (close) => h('form', { class: 'form', onsubmit: (ev) => { ev.preventDefault(); close(inp.value.trim()); } }, field('Name', inp),
        h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Save', null, { variant: 'primary', type: 'submit' }))),
    });
    if (!v) return;
    session.name = v;
    await saveNow();
    draw();
  }

  async function pause() { W.pauseSession(session); await saveNow(); draw(); }
  async function resume() { W.resumeSession(session); await saveNow(); draw(); }

  async function discard() {
    const sum = sessionSummary(session);
    const ok = await confirmDialog({
      title: 'Discard workout?',
      message: sum.setsDone ? `This permanently deletes this workout and its ${plural(sum.setsDone, 'recorded set')}. This cannot be undone.` : 'This deletes the workout. Nothing has been recorded yet.',
      confirmLabel: 'Discard workout',
      danger: true,
    });
    if (!ok) return;
    clearTimeout(saveTimer);
    await store.deleteSession(session.id);
    keepScreenOn(false);
    toast('Workout discarded.');
    navigate('#/');
  }

  async function finish() {
    const sum = sessionSummary(session);
    const notDone = session.entries.filter((e) => e.status !== 'skipped' && !e.sets.some((s) => s.done));
    const notes = textarea(session.notes, { rows: 3, maxlength: 2000, placeholder: 'How did it go? (optional)' });
    const res = await openDialog({
      title: 'Finish workout',
      sheet: false,
      build: (close) => h('div', { class: 'form' },
        h('div', { class: 'stat-row' },
          h('div', { class: 'stat' }, h('strong', null, fmtDuration(sessionElapsedSec(session))), h('span', null, 'duration')),
          h('div', { class: 'stat' }, h('strong', null, String(sum.setsDone)), h('span', null, 'sets')),
          h('div', { class: 'stat' }, h('strong', null, fmtNum(Math.round(sum.volumeKg), 0)), h('span', null, 'kg volume'))),
        sum.setsDone === 0 && session.kind === 'workout' ? h('p', { class: 'notice' }, icon('warn'), h('span', null, 'No sets are marked as done yet. You can still save it.')) : null,
        notDone.length ? h('p', { class: 'muted small' }, `${plural(notDone.length, 'exercise')} without completed sets will be saved as not performed: ${notDone.map((e) => e.exercise?.name).join(', ')}.`) : null,
        field('Notes', notes),
        h('div', { class: 'dialog-actions' }, btn('Keep training', () => close(), { variant: 'ghost' }), btn('Save workout', () => close({ notes: notes.value.trim() }), { variant: 'primary', icon: 'check' }))),
    });
    if (!res) return;
    session.notes = res.notes;
    W.finishSession(session);
    await saveNow();
    keepScreenOn(false);
    const prs = newRecordsIn(session, store.state.sessions);
    navigate(`#/history/${session.id}?done=1${prs.length ? `&prs=${prs.length}` : ''}`);
  }

  // ----- rest dock & timers -----

  function restDock() {
    const dock = h('div', { class: 'rest-dock', hidden: true, role: 'region', 'aria-label': 'Rest timer' });
    refs.dock = dock;
    refs.dockTime = h('span', { class: 'rest-time mono', 'aria-live': 'off' });
    refs.dockLabel = h('span', { class: 'rest-label' });
    refs.dockBar = h('span', { class: 'rest-bar-fill' });
    refs.dockSr = h('span', { class: 'sr-only', 'aria-live': 'assertive' });
    const r = session.rest;
    const paused = r && Number.isFinite(r.pausedRemainingMs);
    dock.append(
      h('div', { class: 'rest-bar', 'aria-hidden': 'true' }, refs.dockBar),
      h('div', { class: 'rest-main' }, h('div', { class: 'rest-text' }, refs.dockLabel, refs.dockTime), refs.dockSr,
        h('div', { class: 'rest-controls' },
          btn('−15 s', () => restAction(() => W.adjustRest(session, -15)), { variant: 'secondary', size: 'sm', ariaLabel: 'Subtract 15 seconds' }),
          btn('+15 s', () => restAction(() => W.adjustRest(session, 15)), { variant: 'secondary', size: 'sm', ariaLabel: 'Add 15 seconds' }),
          iconBtn(paused ? 'play' : 'pause', paused ? 'Resume rest timer' : 'Pause rest timer', () => restAction(() => (paused ? W.resumeRest(session) : W.pauseRest(session))), { variant: 'secondary' }),
          iconBtn('reset', 'Restart rest timer', () => restAction(() => W.resetRest(session)), { variant: 'secondary' }),
          btn('Skip', () => restAction(() => W.clearRest(session)), { variant: 'primary', size: 'sm', icon: 'skip', ariaLabel: 'Skip rest' }))));
    return dock;
  }

  async function restAction(fn) {
    primeAudio();
    fn();
    await saveNow();
    draw();
  }

  function updateTimers(now = Date.now()) {
    if (refs.elapsed && !editMode) refs.elapsed.textContent = fmtDuration(sessionElapsedSec(session, now));
    const dock = refs.dock;
    if (!dock) return;
    const r = session.rest;
    if (!r || session.status !== 'active') { dock.hidden = true; document.body.classList.remove('has-rest'); return; }
    dock.hidden = false;
    document.body.classList.add('has-rest');
    const remaining = W.restRemainingMs(r, now);
    const done = remaining <= 0;
    const nextName = r.entryId ? W.findEntry(session, r.entryId)?.exercise?.name : null;
    dock.classList.toggle('is-done', done);
    dock.classList.toggle('is-paused', Number.isFinite(r.pausedRemainingMs));
    refs.dockTime.textContent = done ? 'Go!' : fmtDuration(Math.ceil(remaining / 1000));
    refs.dockLabel.textContent = done ? `Rest over${nextName ? ` · next: ${nextName}` : ''}` : `${Number.isFinite(r.pausedRemainingMs) ? 'Rest paused' : 'Rest'}${nextName ? ` · next: ${nextName}` : ''}`;
    const total = Math.max(1, r.durationSec * 1000);
    refs.dockBar.style.width = `${Math.max(0, Math.min(100, (remaining / total) * 100))}%`;
    if (done && !r.alerted) {
      r.alerted = true;
      refs.dockSr.textContent = 'Rest over.';
      // Only alert if the timer just ended (not when returning to the app minutes later).
      if (now - r.endsAt < 5000 && !document.hidden) {
        if (settings.restSound) beep();
        if (settings.restVibrate) vibrate();
      }
      saveSoon();
    }
  }

  draw();
  const offTick = onTick(updateTimers);
  if (!editMode && settings.keepScreenOn !== false) keepScreenOn(true);
  const flush = () => { if (saveTimer) saveNow(); };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', flush);
  return () => {
    offTick();
    flush();
    window.removeEventListener('pagehide', flush);
    document.removeEventListener('visibilitychange', flush);
    document.body.classList.remove('has-rest');
    keepScreenOn(false);
  };
}
