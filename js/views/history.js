// History list and session detail.

import * as store from '../store.js';
import { h, btn, pageHead, emptyState, input, segmented, toast, confirmDialog, select } from '../ui.js';
import { icon } from '../icons.js';
import { navigate, setQuery } from '../shell.js';
import { startFromTemplate } from '../actions.js';
import { sessionSummary, sessionTitle, newRecordsIn, paceSecPerKm, speedKmh, GROUP_TYPES } from '../model.js';
import { groupUnits } from '../workout-logic.js';
import { fmtDate, fmtTime, fmtDuration, fmtDurationWords, fmtNum, plural, fmtWeekday, addDays, startOfDay } from '../util.js';
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
      const d = new Date(s.startedAt);
      ul.append(h('li', null, h('a', { href: `#/history/${s.id}`, class: ['row-link', 'hist-row', s.id === selectedId ? 'selected' : ''], 'aria-current': s.id === selectedId ? 'true' : null },
        h('span', { class: 'date-badge', 'aria-hidden': 'true' }, h('strong', null, String(d.getDate())), h('span', null, fmtWeekday(s.startedAt))),
        h('span', { class: 'row-main' },
          h('strong', null, sessionTitle(s), s.kind === 'activity' ? h('span', { class: 'badge' }, 'Activity') : null),
          h('span', { class: 'muted small' }, `${fmtDate(s.startedAt, { day: 'numeric', month: 'short' })} ${fmtTime(s.startedAt)} · ${summaryLine(s)}`)),
        icon('forward'))));
    }
    if (!items.length) {
      blocks.push(store.completedSessions().length
        ? h('p', { class: 'empty-row' }, 'No sessions match these filters.')
        : emptyState('No history yet', 'Finish a workout or log an activity and it will appear here.', h('a', { class: 'btn btn-primary', href: '#/train' }, 'Start training'), 'history'));
    }
    listEl.replaceChildren(...blocks);
  };
  search.addEventListener('input', () => { setQuery({ q: search.value }); draw(); });
  range.addEventListener('change', () => { setQuery({ range: range.value === 'all' ? '' : range.value }); draw(); });
  wrap.append(h('div', { class: 'toolbar' }, search, range), h('div', { class: 'toolbar between' }, kindSeg, count), listEl);
  draw();
  return wrap;
}

export function renderHistory({ el, query }) {
  el.append(pageHead('History', { actions: [h('a', { class: 'btn btn-secondary', href: '#/activity/new' }, icon('plus'), h('span', null, 'Log activity'))] }));
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
    detail.append(h('section', { class: 'card success-card', role: 'status' },
      h('h2', null, icon('check'), ' Workout saved'),
      prs.length ? h('div', null, h('p', null, `New personal ${prs.length === 1 ? 'record' : 'records'}:`),
        h('ul', { class: 'pr-list' }, prs.map((r) => h('li', null, icon('trophy'), h('span', null, h('strong', null, r.name), ` ${r.label.toLowerCase()}: ${formatRecordValue(r.key, r.value, r.extra)}`, r.previous ? h('span', { class: 'muted' }, ` (was ${formatRecordValue(r.key, r.previous, {})})`) : null)))))
        : h('p', { class: 'muted small' }, 'Nice work. It is stored on this device.')));
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
  const done = e.sets.filter((x) => x.done).length;
  const status = e.status === 'skipped' ? 'Skipped' : done === 0 ? 'Not performed' : done < e.sets.length ? `${done} of ${e.sets.length} sets done` : 'Completed';
  const block = h('article', { class: 'entry-detail' },
    h('div', { class: 'entry-head' },
      h('div', { class: 'row-main' },
        h('h3', null, e.exercise?.name || 'Exercise'),
        h('p', { class: 'muted small' }, [status, e.adHoc ? 'Added during workout' : null].filter(Boolean).join(' · ')))));
  if (e.substitution) {
    block.append(h('p', { class: 'swap-note small' }, icon('swap'),
      h('span', null, h('strong', null, 'Substitution: '), `planned ${e.plannedExercise?.name || e.substitution.fromName || '—'}, performed ${e.exercise?.name}`,
        e.substitution.note ? ` — “${e.substitution.note}”` : '')));
  }
  if (e.sets.length) {
    const table = h('table', { class: 'sets-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, 'Set'), h('th', { scope: 'col' }, 'Planned'), h('th', { scope: 'col' }, 'Performed'), h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Status')))),
      h('tbody', null, e.sets.map((st, i) => h('tr', { class: st.done ? 'done' : 'not-done' },
        h('td', null, String(i + 1)),
        h('td', { class: 'muted' }, fmtSetValues(st.planned, type) || '—'),
        h('td', null, st.done ? (fmtSetValues(st.actual, type) || 'Done') : h('span', { class: 'muted' }, 'Not done'), st.note ? h('div', { class: 'small muted' }, st.note) : null),
        h('td', null, st.done ? h('span', { class: 'ok', 'aria-label': 'Done' }, icon('check')) : null)))));
    block.append(table);
  }
  if (e.planNotes) block.append(h('p', { class: 'small muted' }, `Plan note: ${e.planNotes}`));
  if (e.notes) block.append(h('p', { class: 'small' }, icon('note'), ` ${e.notes}`));
  return block;
}
