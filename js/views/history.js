// History list and session detail.

import * as store from '../store.js';
import { h, btn, pageHead, emptyState, input, segmented, toast, confirmDialog, select, openDialog, field, numInput } from '../ui.js';
import { icon } from '../icons.js';
import { navigate, setQuery } from '../shell.js';
import { startFromTemplate, createPastWorkout, shareBackup } from '../actions.js';
import { sessionSummary, sessionTitle, newRecordsIn, paceSecPerKm, speedKmh, GROUP_TYPES, SET_KINDS, setKind, backupDue } from '../model.js';
import { groupUnits } from '../workout-logic.js';
import { fmtDate, fmtTime, fmtDuration, fmtDurationWords, fmtNum, plural, fmtWeekday, addDays, startOfDay, startOfWeek, isoDate, isoDateTimeLocal, parseLocalDate, num } from '../util.js';
import { mountSessionEditor, fmtSetValues } from './workout.js';
import { formatRecordValue } from './progress.js';

const RANGES = [['all', 'All time'], ['30', 'Last 30 days'], ['90', 'Last 3 months'], ['365', 'Last 12 months']];

function matches(s, q) {
  if (!q) return true;
  const n = q.toLowerCase();
  if (sessionTitle(s).toLowerCase().includes(n) || (s.notes || '').toLowerCase().includes(n) || (s.programName || '').toLowerCase().includes(n)) return true;
  return (s.entries || []).some((e) => (e.exercise?.name || '').toLowerCase().includes(n) || (e.plannedExercise?.name || '').toLowerCase().includes(n));
}

export function summaryLine(s) {
  const sum = sessionSummary(s);
  const parts = [];
  if (sum.durationSec) parts.push(fmtDurationWords(sum.durationSec));
  if (s.kind === 'workout') {
    parts.push(plural(sum.setsDone, 'set'));
    if (sum.volumeKg) parts.push(`${fmtNum(Math.round(sum.volumeKg), 0)} kg`);
    if (sum.distanceKm) parts.push(`${fmtNum(sum.distanceKm, 2)} km`);
  } else {
    if (sum.distanceKm) parts.push(`${fmtNum(sum.distanceKm, 2)} km`);
    const pace = paceSecPerKm(sum.durationSec, sum.distanceKm);
    if (pace) parts.push(s.activity?.exercise?.cardioDisplay === 'speed' ? `${fmtNum(speedKmh(sum.durationSec, sum.distanceKm), 1)} km/h` : `${fmtDuration(pace)} /km`);
  }
  return parts.join(' · ');
}

function historyList(query, selectedId) {
  const wrap = h('div', { class: 'md-list' });
  let kind = query.kind || 'all';
  const view = query.view === 'cal' ? 'cal' : 'list';
  let calMonth = /^\d{4}-\d{2}$/.test(query.month || '') ? query.month : isoDate(Date.now()).slice(0, 7);
  let calDay = query.day || null;
  const search = input({ type: 'search', placeholder: 'Search workouts, exercises, notes', 'aria-label': 'Search history', value: query.q || '', class: 'search' });
  const range = select(RANGES, query.range || 'all', { 'aria-label': 'Date range' });
  const listEl = h('div', { class: 'history-list' });
  const count = h('p', { class: 'muted small', 'aria-live': 'polite' });
  const kindSeg = segmented([['all', 'All'], ['workout', 'Workouts'], ['activity', 'Activities']], kind, (v) => {
    kind = v;
    setQuery({ kind: v === 'all' ? '' : v });
    for (const b of kindSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    draw();
  }, 'Session type');
  [...kindSeg.querySelectorAll('button')].forEach((b, i) => { b.dataset.v = ['all', 'workout', 'activity'][i]; });

  const draw = () => {
    const from = range.value === 'all' ? 0 : addDays(startOfDay(Date.now()), -Number(range.value));
    const items = store.completedSessions().filter((s) => (kind === 'all' || s.kind === kind) && s.startedAt >= from && matches(s, search.value.trim()));
    count.textContent = plural(items.length, 'session');
    if (view === 'cal') { listEl.replaceChildren(calendar(items)); return; }
    const blocks = [];
    let month = null;
    let ul = null;
    for (const s of items) {
      const m = fmtDate(s.startedAt, { month: 'long', year: 'numeric' });
      if (m !== month) {
        month = m;
        const monthItems = items.filter((x) => fmtDate(x.startedAt, { month: 'long', year: 'numeric' }) === m);
        blocks.push(h('h2', { class: 'list-label' }, m, h('span', { class: 'muted' }, ` · ${plural(monthItems.length, 'session')}`)));
        ul = h('ul', { class: 'list' });
        blocks.push(ul);
      }
      ul.append(sessionRow(s, selectedId));
    }
    if (!items.length) {
      blocks.push(store.completedSessions().length
        ? h('p', { class: 'empty-row' }, 'No sessions match these filters.')
        : emptyState('No history yet', 'Finish a workout or log an activity and it will appear here.', h('a', { class: 'btn btn-primary', href: '#/train' }, 'Start training'), 'history'));
    }
    listEl.replaceChildren(...blocks);
  };
  // Month grid; tapping a day lists that day's sessions underneath.
  function calendar(items) {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1).getTime();
    const weekStart = store.state.settings.weekStart ?? 1;
    const gridStart = startOfWeek(first, weekStart);
    const byDay = new Map();
    for (const s of items) { const k = isoDate(s.startedAt); byDay.set(k, [...(byDay.get(k) || []), s]); }
    const today = isoDate(Date.now());
    const shift = (d) => { const dt = new Date(y, m - 1 + d, 1); calMonth = isoDate(dt.getTime()).slice(0, 7); calDay = null; setQuery({ month: calMonth, day: '' }); draw(); };
    const grid = h('div', { class: 'cal-grid', role: 'grid', 'aria-label': fmtDate(first, { month: 'long', year: 'numeric' }) });
    for (let i = 0; i < 7; i++) grid.append(h('span', { class: 'cal-dow', 'aria-hidden': 'true' }, fmtWeekday(addDays(gridStart, i)).slice(0, 2)));
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const key = isoDate(d);
      const inMonth = new Date(d).getMonth() === m - 1;
      if (!inMonth && i >= 35) break;
      const list = byDay.get(key) || [];
      grid.append(h('button', {
        type: 'button', class: ['cal-day', inMonth ? '' : 'out', list.length ? 'has' : '', key === today ? 'today' : '', key === calDay ? 'sel' : ''],
        'aria-pressed': String(key === calDay),
        'aria-label': `${fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}: ${list.length ? plural(list.length, 'session') : 'no sessions'}`,
        onclick: () => { calDay = key; setQuery({ day: key }); draw(); },
      }, h('span', null, String(new Date(d).getDate())), list.length ? h('span', { class: 'cal-dots', 'aria-hidden': 'true' }, list.slice(0, 3).map((s) => h('i', { class: s.kind }))) : null));
    }
    const monthCount = items.filter((s) => isoDate(s.startedAt).startsWith(calMonth)).length;
    const dayList = calDay ? (byDay.get(calDay) || []) : [];
    return h('div', { class: 'calendar' },
      h('div', { class: 'cal-head' },
        btn('Previous month', () => shift(-1), { iconOnly: true, icon: 'back', variant: 'icon' }),
        h('h2', null, fmtDate(first, { month: 'long', year: 'numeric' }), h('span', { class: 'muted small' }, ` · ${plural(monthCount, 'session')}`)),
        btn('Next month', () => shift(1), { iconOnly: true, icon: 'forward', variant: 'icon' })),
      grid,
      h('p', { class: 'muted small cal-legend' }, h('i', { class: 'workout' }), ' workout  ', h('i', { class: 'activity' }), ' activity'),
      calDay ? h('div', null, h('h3', { class: 'list-label' }, fmtDate(parseLocalDate(calDay), { weekday: 'long', day: 'numeric', month: 'long' })),
        dayList.length ? h('ul', { class: 'list' }, dayList.map((s) => sessionRow(s, selectedId))) : h('p', { class: 'muted small' }, 'Nothing recorded this day.')) : null);
  }

  search.addEventListener('input', () => { setQuery({ q: search.value }); draw(); });
  range.addEventListener('change', () => { setQuery({ range: range.value === 'all' ? '' : range.value }); draw(); });
  const viewSeg = segmented([['list', 'List'], ['cal', 'Calendar']], view, (v) => { setQuery({ view: v === 'cal' ? 'cal' : '' }); navigate(location.hash, { replace: true }); }, 'History view');
  wrap.append(h('div', { class: 'toolbar' }, search, range), h('div', { class: 'toolbar between' }, kindSeg, viewSeg, count), listEl);
  draw();
  return wrap;
}

function sessionRow(s, selectedId) {
  const d = new Date(s.startedAt);
  return h('li', null, h('a', { href: `#/history/${s.id}${location.hash.includes('?') ? `?${location.hash.split('?')[1]}` : ''}`, class: ['row-link', 'hist-row', s.id === selectedId ? 'selected' : ''], 'aria-current': s.id === selectedId ? 'true' : null },
    h('span', { class: 'date-badge', 'aria-hidden': 'true' }, h('strong', null, String(d.getDate())), h('span', null, fmtWeekday(s.startedAt))),
    h('span', { class: 'row-main' },
      h('strong', null, sessionTitle(s), s.kind === 'activity' ? h('span', { class: 'badge' }, 'Activity') : null, s.imported ? h('span', { class: 'badge' }, 'Imported') : null),
      h('span', { class: 'muted small' }, `${fmtDate(s.startedAt, { day: 'numeric', month: 'short' })} ${fmtTime(s.startedAt)} · ${summaryLine(s)}`)),
    icon('forward')));
}

async function addPastWorkoutDialog() {
  const programs = store.programsSorted();
  const opts = [['', 'Empty workout (add exercises yourself)']];
  for (const p of programs) for (const t of store.templatesFor(p.id)) opts.push([t.id, `${p.name} – ${t.name}`]);
  const tpl = select(opts, '');
  const yesterday = new Date(Date.now() - 86400000); yesterday.setHours(18, 0, 0, 0);
  const when = input({ type: 'datetime-local', value: isoDateTimeLocal(yesterday.getTime()), max: isoDateTimeLocal(Date.now()) });
  const mins = numInput(60, { integer: true });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const res = await openDialog({
    title: 'Add past workout', sheet: false,
    build: (close) => h('form', {
      class: 'form', onsubmit: (ev) => {
        ev.preventDefault();
        const t = parseLocalDate(when.value);
        const m = num(mins.value);
        if (!t || t > Date.now()) { err.textContent = 'Enter a date and time in the past.'; err.hidden = false; return; }
        if (m === null || m < 0 || m > 1440) { err.textContent = 'Duration must be 0–1440 minutes.'; err.hidden = false; return; }
        close({ templateId: tpl.value || null, startedAt: t, durationMin: m });
      },
    }, err,
    h('p', { class: 'muted small' }, 'For workouts you did not log at the time, or entries from an old diary. You tick the sets you did on the next screen.'),
    field('Workout', tpl), field('Started', when), field('Duration', mins, { unit: 'minutes' }),
    h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Continue', null, { variant: 'primary', type: 'submit' }))),
  });
  if (res) await createPastWorkout(res);
}

export function renderHistory({ el, query }) {
  el.append(pageHead('History', { actions: [
    store.state.settings.simpleLogging
      ? h('a', { class: 'btn btn-secondary', href: '#/quick' }, icon('plus'), h('span', null, 'Log workout'))
      : btn('Past workout', addPastWorkoutDialog, { icon: 'plus' }),
    h('a', { class: 'btn btn-secondary', href: '#/activity/new' }, icon('plus'), h('span', null, 'Log activity')),
  ] }));
  const md = h('div', { class: 'md' });
  md.append(historyList(query, null), h('div', { class: 'md-detail md-placeholder' }, emptyState('Select a session', 'Open a workout or activity to see everything that was planned and performed.', null, 'history')));
  el.append(md);
}

export function renderSession(ctx) {
  const { el, params, query } = ctx;
  const s = store.sessionById(params[0]);
  if (!s) {
    el.append(pageHead('Session not found', { back: '#/history' }), emptyState('This session does not exist', 'It may have been deleted.', h('a', { class: 'btn', href: '#/history' }, 'Back to history')));
    return null;
  }
  if (s.status === 'active') { navigate('#/workout', { replace: true }); return null; }
  if (query.edit && s.kind === 'workout') return mountSessionEditor(ctx, s, { mode: 'edit' });

  el.append(pageHead(sessionTitle(s), { back: '#/history', kicker: `${fmtDate(s.startedAt, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${fmtTime(s.startedAt)}` }));
  const md = h('div', { class: 'md has-detail' });
  const detail = h('div', { class: 'md-detail' });
  md.append(historyList({}, s.id), detail);
  el.append(md);

  if (query.done) {
    const prs = newRecordsIn(s, store.state.sessions);
    const backup = backupDue(store.state.sessions, store.state.settings);
    detail.append(h('section', { class: 'card success-card', role: 'status' },
      h('h2', null, icon('check'), ' Workout saved'),
      prs.length ? h('div', null, h('p', null, `New personal ${prs.length === 1 ? 'record' : 'records'}:`),
        h('ul', { class: 'pr-list' }, prs.map((r) => h('li', null, icon('trophy'), h('span', null, h('strong', null, r.name), ` ${r.label.toLowerCase()}: ${formatRecordValue(r.key, r.value, r.extra, r.snap)}`, r.previous !== null ? h('span', { class: 'muted' }, ` (was ${formatRecordValue(r.key, r.previous, {}, r.snap)})`) : null)))))
        : h('p', { class: 'muted small' }, 'Nice work. It is stored on this device.'),
      backup.due ? h('div', { class: 'notice small' }, icon('download'), h('span', null, `${plural(backup.pending, 'session')} since your last backup. `),
        btn('Back up now', () => shareBackup(), { size: 'sm', variant: 'primary' })) : null));
  }

  const sum = sessionSummary(s);
  const stats = h('div', { class: 'stat-row' },
    h('div', { class: 'stat' }, h('strong', null, fmtDuration(sum.durationSec) || '—'), h('span', null, 'duration')));
  if (s.kind === 'workout') {
    stats.append(
      h('div', { class: 'stat' }, h('strong', null, `${sum.setsDone}`), h('span', null, `of ${sum.setsPlanned} sets`)),
      h('div', { class: 'stat' }, h('strong', null, `${sum.exercisesDone}`), h('span', null, 'exercises')),
      h('div', { class: 'stat' }, h('strong', null, fmtNum(Math.round(sum.volumeKg), 0)), h('span', null, 'kg volume')));
  } else {
    const a = s.activity;
    if (Number.isFinite(a.distanceKm)) stats.append(h('div', { class: 'stat' }, h('strong', null, fmtNum(a.distanceKm, 2)), h('span', null, 'km')));
    const pace = paceSecPerKm(a.durationSec, a.distanceKm);
    if (pace) {
      stats.append(h('div', { class: 'stat' }, h('strong', null, fmtDuration(pace)), h('span', null, 'min/km')));
      stats.append(h('div', { class: 'stat' }, h('strong', null, fmtNum(speedKmh(a.durationSec, a.distanceKm), 1)), h('span', null, 'km/h')));
    }
  }
  detail.append(h('section', { class: 'card' }, stats,
    s.programName ? h('p', { class: 'muted small' }, `Program: ${s.programName}${s.templateName ? ` · Template: ${s.templateName}` : ''}`) : null,
    s.notes ? h('p', { class: 'session-notes' }, icon('note'), h('span', null, s.notes)) : null,
    h('div', { class: 'form-actions' },
      s.kind === 'workout'
        ? h('a', { class: 'btn btn-secondary', href: `#/history/${s.id}?edit=1` }, icon('edit'), h('span', null, 'Edit sets'))
        : h('a', { class: 'btn btn-secondary', href: `#/activity/${s.id}` }, icon('edit'), h('span', null, 'Edit')),
      s.templateId && store.templateById(s.templateId) ? btn('Do this workout again', () => startFromTemplate(s.templateId), { icon: 'play' }) : null,
      btn('Delete', async () => {
        if (await confirmDialog({ title: 'Delete session?', message: `Permanently delete "${sessionTitle(s)}" from ${fmtDate(s.startedAt)}? This cannot be undone.`, confirmLabel: 'Delete', danger: true })) {
          await store.deleteSession(s.id);
          toast('Session deleted.');
          navigate('#/history', { replace: true });
        }
      }, { variant: 'ghost', class: 'danger-text', icon: 'trash' }))));

  if (s.kind === 'activity') detail.append(activityDetail(s));
  else detail.append(workoutDetail(s));
  return null;
}

function activityDetail(s) {
  const a = s.activity;
  const rows = [
    ['Activity', a.exercise?.name],
    ['Duration', a.durationSec ? fmtDuration(a.durationSec) : null],
    ['Distance', Number.isFinite(a.distanceKm) ? `${fmtNum(a.distanceKm, 2)} km` : null],
    ['Elevation gain', Number.isFinite(a.elevationM) ? `${fmtNum(a.elevationM, 0)} m` : null],
    ['Calories (entered)', Number.isFinite(a.calories) ? `${fmtNum(a.calories, 0)} kcal` : null],
    ['Average heart rate (entered)', Number.isFinite(a.avgHr) ? `${fmtNum(a.avgHr, 0)} bpm` : null],
    ['Max heart rate (entered)', Number.isFinite(a.maxHr) ? `${fmtNum(a.maxHr, 0)} bpm` : null],
    ...(a.extra || []).map((x) => [x.label, `${x.value}${x.unit ? ` ${x.unit}` : ''}`]),
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');
  return h('section', { class: 'card' }, h('h2', null, 'Details'),
    h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', null, k), h('dd', null, v)])));
}

function workoutDetail(s) {
  const wrap = h('div', { class: 'stack' });
  const units = groupUnits(s);
  if (!units.length) wrap.append(h('section', { class: 'card' }, h('p', { class: 'muted' }, 'No exercises were recorded.')));
  for (const u of units) {
    const box = h('section', { class: ['card', u.groupId ? 'is-group' : ''] });
    if (u.groupId) box.append(h('p', { class: 'group-tag' }, icon('link'), GROUP_TYPES[u.group?.type] || 'Superset'));
    for (const e of u.entries) box.append(entryDetail(e));
    wrap.append(box);
  }
  return wrap;
}

function entryDetail(e) {
  const type = e.exercise?.type || 'strength';
  const working = e.sets.filter((x) => setKind(x) !== 'warmup');
  const done = working.filter((x) => x.done).length;
  const warm = e.sets.length - working.length;
  const status = e.status === 'skipped' ? 'Skipped' : done === 0 ? 'Not performed' : done < working.length ? `${done} of ${working.length} sets done` : 'Completed';
  const block = h('article', { class: 'entry-detail' },
    h('div', { class: 'entry-head' },
      h('div', { class: 'row-main' },
        h('h3', null, e.exercise?.name || 'Exercise'),
        h('p', { class: 'muted small' }, [status, warm ? plural(warm, 'warm-up set') : null, e.adHoc ? 'Added during workout' : null, e.imported ? 'Imported' : null].filter(Boolean).join(' · ')))));
  if (e.substitution) {
    block.append(h('p', { class: 'swap-note small' }, icon('swap'),
      h('span', null, h('strong', null, 'Substitution: '), `planned ${e.plannedExercise?.name || e.substitution.fromName || '—'}, performed ${e.exercise?.name}`,
        e.substitution.note ? ` — “${e.substitution.note}”` : '')));
  }
  if (e.sets.length) {
    const table = h('table', { class: 'sets-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Set'), h('th', { scope: 'col' }, 'Planned'), h('th', { scope: 'col' }, 'Performed'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Status')))),
      h('tbody', null, e.sets.map((st, i) => h('tr', { class: [st.done ? 'done' : 'not-done', `kind-${setKind(st)}`] },
        h('td', null, setKind(st) === 'working' ? String(e.sets.slice(0, i + 1).filter((x) => setKind(x) !== 'warmup').length) : h('abbr', { title: SET_KINDS[setKind(st)].label }, SET_KINDS[setKind(st)].short)),
        h('td', { class: 'muted' }, fmtSetValues(st.planned, type, e.exercise) || '—'),
        h('td', null, st.done ? (fmtSetValues(st.actual, type, e.exercise) || 'Done') : h('span', { class: 'muted' }, 'Not done'), st.note ? h('div', { class: 'small muted' }, st.note) : null),
        h('td', null, st.done ? h('span', { class: 'ok', 'aria-label': 'Done' }, icon('check')) : null)))));
    block.append(table);
  }
  if (e.planNotes) block.append(h('p', { class: 'small muted' }, `Plan note: ${e.planNotes}`));
  if (e.notes) block.append(h('p', { class: 'small' }, icon('note'), ` ${e.notes}`));
  return block;
}
