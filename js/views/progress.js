// Progress: strength and cardio charts, personal records and body measurements.

import * as store from '../store.js';
import { h, btn, iconBtn, pageHead, emptyState, select, segmented, numInput, input, field, toast, confirmDialog, openDialog } from '../ui.js';
import { setQuery, navigate } from '../shell.js';
import { timeChart } from '../charts.js';
import { exerciseHistory, computeRecords, RECORD_LABELS, speedKmh, paceSecPerKm, fmtKg } from '../model.js';
import { fmtDate, fmtDateShort, fmtDuration, fmtNum, plural, addDays, startOfDay, startOfWeek, isoDate, parseLocalDate, uid, num } from '../util.js';

const RANGES = [['30', '1M'], ['90', '3M'], ['180', '6M'], ['365', '1Y'], ['all', 'All']];

export function formatRecordValue(key, value, extra = {}, snap = null) {
  const kg = (v) => fmtKg(v, snap, (x) => fmtNum(x));
  switch (key) {
    case 'maxWeightKg': return `${kg(value)}${extra.reps ? ` × ${extra.reps}` : ''}`;
    case 'leastAssistKg': return `${kg(value)}${extra.reps ? ` × ${extra.reps}` : ''}`;
    case 'bestE1rmKg': return `${fmtNum(value, 1)} kg${extra.weightKg ? ` (from ${fmtNum(extra.weightKg)} kg × ${extra.reps})` : ''}`;
    case 'maxReps': return `${fmtNum(value, 0)} reps${extra.weightKg ? ` @ ${fmtNum(extra.weightKg)} kg` : ''}`;
    case 'maxSessionVolumeKg': return `${fmtNum(Math.round(value), 0)} kg`;
    case 'longestSetSec': return fmtDuration(value);
    case 'longestDistanceKm': return `${fmtNum(value, 2)} km`;
    case 'longestDurationSec': return fmtDuration(value);
    case 'bestPaceSecPerKm': return `${fmtDuration(value)} /km${extra.distanceKm ? ` over ${fmtNum(extra.distanceKm, 2)} km` : ''}`;
    default: return String(value);
  }
}

function rangeStart(range) {
  return range === 'all' ? 0 : addDays(startOfDay(Date.now()), -Number(range));
}

export function renderProgress(ctx) {
  const { el, query } = ctx;
  const tab = query.tab || 'strength';
  el.append(pageHead('Progress'));
  el.append(h('nav', { class: 'tabs', 'aria-label': 'Progress sections' },
    [['strength', 'Strength'], ['cardio', 'Cardio'], ['records', 'Records'], ['body', 'Body']].map(([k, l]) =>
      h('a', { class: 'tab', href: `#/progress?tab=${k}`, 'aria-current': tab === k ? 'page' : null }, l))));
  const body = h('div', { class: 'progress-body' });
  el.append(body);
  const charts = [];
  const cleanup = () => { for (const c of charts) c.destroy(); };
  if (tab === 'strength') strengthTab(body, query, charts);
  else if (tab === 'cardio') cardioTab(body, query, charts);
  else if (tab === 'records') recordsTab(body);
  else bodyTab(body, query, charts, ctx);
  return cleanup;
}

// ---------- shared chart panel ----------

function exercisesWithHistory(types) {
  const seen = new Map();
  for (const s of store.completedSessions()) {
    if (s.kind === 'activity') {
      const a = s.activity;
      if (a?.exerciseId && types.includes(a.exercise?.type || 'cardio') && !seen.has(a.exerciseId)) seen.set(a.exerciseId, { id: a.exerciseId, name: store.exerciseById(a.exerciseId)?.name || a.exercise?.name, type: a.exercise?.type, last: s.startedAt, n: 0 });
      if (a?.exerciseId && seen.has(a.exerciseId)) seen.get(a.exerciseId).n++;
      continue;
    }
    for (const e of s.entries || []) {
      if (!types.includes(e.exercise?.type) || !e.sets.some((x) => x.done)) continue;
      if (!seen.has(e.exerciseId)) seen.set(e.exerciseId, { id: e.exerciseId, name: store.exerciseById(e.exerciseId)?.name || e.exercise?.name, type: e.exercise?.type, last: s.startedAt, n: 0 });
      seen.get(e.exerciseId).n++;
    }
  }
  return [...seen.values()];
}

function chartPanel({ title, points, unit, label, yFormat, reverseY, note, charts, type = 'line', minPoints = 2 }) {
  const wrap = h('section', { class: 'card chart-card', 'aria-label': title });
  wrap.append(h('div', { class: 'card-head' }, h('h2', null, title), note ? h('span', { class: 'muted small' }, note) : null));
  if (points.length < minPoints) {
    wrap.append(emptyState(points.length ? 'Not enough data for a trend yet' : 'No data in this period',
      points.length ? `Only ${plural(points.length, 'session')} in this range. A chart appears from ${minPoints} sessions.` : 'Try a longer date range, or record more sessions.', null, 'progress'));
    return wrap;
  }
  const canvas = h('canvas', { role: 'img', 'aria-label': `${title} chart. Values are listed in the table below.` });
  wrap.append(h('div', { class: 'chart-box' }, canvas));
  timeChart(canvas, {
    points, unit, label, yFormat, reverseY, type,
    onPointClick: (p) => { if (p.sessionId) navigate(`#/history/${p.sessionId}`); },
  }).then((c) => charts.push(c)).catch((e) => {
    wrap.querySelector('.chart-box').replaceWith(h('p', { class: 'form-error' }, e.message));
  });
  wrap.append(h('p', { class: 'muted small' }, 'Tap a point to open that session.'));
  return wrap;
}

function trendSummary(points, fmt, lowerIsBetter = false) {
  if (!points.length) return null;
  const first = points[0].y;
  const lastP = points[points.length - 1];
  const best = points.reduce((a, p) => (lowerIsBetter ? (p.y < a.y ? p : a) : (p.y > a.y ? p : a)), points[0]);
  const diff = lastP.y - first;
  return h('div', { class: 'stat-row' },
    h('div', { class: 'stat' }, h('strong', null, fmt(lastP.y)), h('span', null, `latest · ${fmtDateShort(lastP.x)}`)),
    h('div', { class: 'stat' }, h('strong', null, fmt(best.y)), h('span', null, `best · ${fmtDateShort(best.x)}`)),
    points.length > 1 ? h('div', { class: 'stat' }, h('strong', null, `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${fmt(Math.abs(diff))}`), h('span', null, 'change in range')) : null);
}

function controls(query, exList, current, metrics, metric, range) {
  const exSel = select(exList.map((e) => [e.id, `${e.name} (${e.n})`]), current, { 'aria-label': 'Exercise' });
  exSel.addEventListener('change', () => { setQuery({ ex: exSel.value }); navigate(location.hash, { replace: true }); });
  const metricSeg = segmented(metrics.map(([k, l]) => [k, l]), metric, (v) => { setQuery({ metric: v }); navigate(location.hash, { replace: true }); }, 'Metric');
  metricSeg.classList.add('scroll-x');
  const rangeSeg = segmented(RANGES, range, (v) => { setQuery({ range: v }); navigate(location.hash, { replace: true }); }, 'Date range');
  return h('div', { class: 'card controls' }, field('Exercise', exSel), h('div', { class: 'control-row' }, metricSeg, rangeSeg));
}

// ---------- strength ----------

function strengthTab(body, query, charts) {
  const list = exercisesWithHistory(['strength', 'bodyweight', 'timed', 'other']).sort((a, b) => b.last - a.last);
  if (!list.length) {
    body.append(emptyState('No strength data yet', 'Complete a workout with ticked sets and your progress will appear here.', h('a', { class: 'btn btn-primary', href: '#/train' }, 'Start a workout'), 'progress'));
    return;
  }
  const exId = list.some((e) => e.id === query.ex) ? query.ex : list[0].id;
  const ex = list.find((e) => e.id === exId);
  const type = ex.type;
  const lib = store.exerciseById(exId);
  const allRows = exerciseHistory(store.state.sessions, exId);
  const lower = lib ? !!lib.lowerIsBetter : !!allRows[allRows.length - 1]?.lowerIsBetter;
  const perHand = (lib?.weightMode || 'total') === 'perHand';
  const snap = { lowerIsBetter: lower, weightMode: perHand ? 'perHand' : 'total' };
  const metrics = lower
    ? [['weight', 'Assistance'], ['maxReps', 'Best set reps'], ['reps', 'Total reps'], ['sets', 'Sets']]
    : type === 'timed'
    ? [['longest', 'Longest set'], ['sets', 'Sets']]
    : type === 'bodyweight'
      ? [['maxReps', 'Best set reps'], ['reps', 'Total reps'], ['weight', 'Added weight'], ['sets', 'Sets']]
      : [['weight', 'Top weight'], ['e1rm', 'Est. 1RM'], ['volume', 'Volume'], ['reps', 'Total reps'], ['sets', 'Sets']];
  const metric = metrics.some(([k]) => k === query.metric) ? query.metric : metrics[0][0];
  const range = query.range || '180';
  const from = rangeStart(range);
  const rows = allRows.filter((r) => r.date >= from);
  const pick = {
    weight: (r) => r.topWeightKg, e1rm: (r) => r.bestE1rm, volume: (r) => r.volumeKg || null, reps: (r) => r.totalReps || null,
    maxReps: (r) => r.maxReps, sets: (r) => r.sets, longest: (r) => r.durationSec,
  }[metric];
  const META = {
    weight: lower ? ['Assistance (lower is better)', 'kg', (v) => fmtNum(v)] : ['Top set weight', perHand ? 'kg/hand' : 'kg', (v) => fmtNum(v)], e1rm: ['Estimated 1RM', 'kg', (v) => fmtNum(v, 1)], volume: ['Volume (weight × reps)', 'kg', (v) => fmtNum(Math.round(v), 0)],
    reps: ['Total reps', 'reps', (v) => fmtNum(v, 0)], maxReps: ['Most reps in one set', 'reps', (v) => fmtNum(v, 0)], sets: ['Sets completed', 'sets', (v) => fmtNum(v, 0)],
    longest: ['Total time under load', 's', (v) => fmtNum(v, 0)],
  }[metric];
  const invert = lower && metric === 'weight';
  const points = rows.map((r) => ({ x: r.date, y: pick(r), sessionId: r.sessionId })).filter((p) => Number.isFinite(p.y) && (p.y > 0 || invert));
  body.append(controls(query, list, exId, metrics, metric, range));
  body.append(h('div', { class: 'progress-grid' },
    h('div', null,
      chartPanel({ title: `${ex.name}: ${META[0]}`, points, unit: META[1], label: META[0], yFormat: META[2], charts, reverseY: invert, note: metric === 'e1rm' ? 'Epley estimate, sets of 1–12 reps' : invert ? 'Axis inverted: up means less assistance' : metric === 'volume' && perHand ? 'Counts both dumbbells' : null }),
      trendSummary(points, (v) => `${META[2](v)} ${META[1]}`, invert)),
    sessionTable(rows, type, snap)));
}

function sessionTable(rows, type, snap = null) {
  const wrap = h('section', { class: 'card', 'aria-label': 'Sessions in range' });
  wrap.append(h('div', { class: 'card-head' }, h('h2', null, 'Sessions'), h('span', { class: 'muted small' }, plural(rows.length, 'session'))));
  if (!rows.length) { wrap.append(h('p', { class: 'muted small' }, 'No sessions in this range.')); return wrap; }
  const cardio = type === 'cardio';
  wrap.append(h('div', { class: 'table-scroll' }, h('table', { class: 'data-table' },
    h('thead', null, h('tr', null,
      h('th', { scope: 'col' }, 'Date'),
      cardio ? [h('th', { scope: 'col' }, 'Distance'), h('th', { scope: 'col' }, 'Time'), h('th', { scope: 'col' }, 'Pace')]
        : type === 'timed' ? [h('th', { scope: 'col' }, 'Sets'), h('th', { scope: 'col' }, 'Total time')]
          : [h('th', { scope: 'col' }, 'Sets'), h('th', { scope: 'col' }, 'Top set'), h('th', { scope: 'col' }, 'Volume')])),
    h('tbody', null, [...rows].reverse().map((r) => h('tr', null,
      h('td', null, h('a', { href: `#/history/${r.sessionId}` }, fmtDate(r.date, { day: 'numeric', month: 'short', year: '2-digit' }))),
      cardio ? [
        h('td', null, Number.isFinite(r.distanceKm) ? `${fmtNum(r.distanceKm, 2)} km` : '—'),
        h('td', null, r.durationSec ? fmtDuration(r.durationSec) : '—'),
        h('td', null, paceSecPerKm(r.durationSec, r.distanceKm) ? `${fmtDuration(paceSecPerKm(r.durationSec, r.distanceKm))} /km` : '—'),
      ] : type === 'timed' ? [
        h('td', null, String(r.sets)),
        h('td', null, r.durationSec ? fmtDuration(r.durationSec) : '—'),
      ] : [
        h('td', null, String(r.sets)),
        h('td', null, Number.isFinite(r.topWeightKg) && (r.topWeightKg > 0 || snap?.lowerIsBetter) ? `${fmtKg(r.topWeightKg, snap, (v) => fmtNum(v))} × ${r.topWeightReps ?? '?'}` : (r.maxReps ? `${r.maxReps} reps` : '—')),
        h('td', null, r.volumeKg ? `${fmtNum(Math.round(r.volumeKg), 0)} kg` : '—'),
      ]))))));
  return wrap;
}

// ---------- cardio ----------

function cardioTab(body, query, charts) {
  const list = exercisesWithHistory(['cardio']).sort((a, b) => b.last - a.last);
  if (!list.length) {
    body.append(emptyState('No cardio data yet', 'Log a run, walk or ride, or record a cardio machine in a workout.', h('a', { class: 'btn btn-primary', href: '#/activity/new' }, 'Log activity'), 'run'));
    return;
  }
  const exId = list.some((e) => e.id === query.ex) ? query.ex : list[0].id;
  const ex = list.find((e) => e.id === exId);
  const lib = store.exerciseById(exId);
  const speedFirst = lib?.cardioDisplay === 'speed';
  const metrics = [['distance', 'Distance'], ['duration', 'Duration'], speedFirst ? ['speed', 'Speed'] : ['pace', 'Pace'], speedFirst ? ['pace', 'Pace'] : ['speed', 'Speed'], ['freq', 'Per week']];
  const metric = metrics.some(([k]) => k === query.metric) ? query.metric : 'distance';
  const range = query.range || '180';
  const from = rangeStart(range);
  const rows = exerciseHistory(store.state.sessions, exId).filter((r) => r.date >= from);
  body.append(controls(query, list, exId, metrics, metric, range));
  let panel;
  let points;
  if (metric === 'freq') {
    // Sessions per week, including weeks with zero, from the first week in range.
    const weekStart = store.state.settings.weekStart ?? 1;
    const start = startOfWeek(range === 'all' ? (rows[0]?.date ?? Date.now()) : from, weekStart);
    const weeks = [];
    for (let w = start; w <= Date.now(); w = addDays(w, 7)) weeks.push({ x: w, y: rows.filter((r) => r.date >= w && r.date < addDays(w, 7)).length });
    points = weeks;
    panel = chartPanel({ title: `${ex.name}: sessions per week`, points, unit: 'sessions', label: 'Sessions', yFormat: (v) => fmtNum(v, 0), charts, type: 'bar', minPoints: 2, note: 'Week start dates' });
    body.append(h('div', { class: 'progress-grid' }, panel, sessionTable(rows, 'cardio')));
    return;
  }
  const META = {
    distance: ['Distance', 'km', (r) => r.distanceKm, (v) => fmtNum(v, 2), false],
    duration: ['Duration', 'min', (r) => (r.durationSec ? r.durationSec / 60 : null), (v) => fmtNum(v, 1), false],
    pace: ['Average pace', 'min/km', (r) => { const p = paceSecPerKm(r.durationSec, r.distanceKm); return p ? p / 60 : null; }, (v) => fmtDuration(v * 60), true],
    speed: ['Average speed', 'km/h', (r) => speedKmh(r.durationSec, r.distanceKm), (v) => fmtNum(v, 1), false],
  }[metric];
  points = rows.map((r) => ({ x: r.date, y: META[2](r), sessionId: r.sessionId })).filter((p) => Number.isFinite(p.y) && p.y > 0);
  body.append(h('div', { class: 'progress-grid' },
    h('div', null,
      chartPanel({ title: `${ex.name}: ${META[0]}`, points, unit: META[1], label: META[0], yFormat: META[3], reverseY: META[4], charts, note: metric === 'pace' ? 'Lower is faster (axis inverted)' : null }),
      trendSummary(points, (v) => `${META[3](v)} ${META[1]}`, META[4])),
    sessionTable(rows, 'cardio')));
}

// ---------- records ----------

function recordsTab(body) {
  const recs = [...computeRecords(store.state.sessions).values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!recs.length) { body.append(emptyState('No records yet', 'Records are calculated from completed sets and activities.', null, 'trophy')); return; }
  body.append(h('p', { class: 'muted small' }, 'Records are per exercise. Different exercises are never compared with each other. Estimated 1RM uses the Epley formula and is an estimate only.'));
  const grid = h('div', { class: 'card-grid' });
  for (const r of recs) {
    const keys = Object.keys(RECORD_LABELS).filter((k) => r[k]);
    if (!keys.length) continue;
    grid.append(h('section', { class: 'card record-card', 'aria-label': `Records for ${r.name}` },
      h('h2', null, r.name),
      h('dl', { class: 'kv' }, keys.flatMap((k) => [
        h('dt', null, RECORD_LABELS[k]),
        h('dd', null, h('a', { href: `#/history/${r[k].sessionId}` }, formatRecordValue(k, r[k].value, r[k], r)), h('span', { class: 'muted small' }, ` · ${fmtDateShort(r[k].date)}`)),
      ]))));
  }
  body.append(grid);
}

// ---------- body measurements ----------

function bodyTab(body, query, charts, ctx) {
  const settings = store.state.settings;
  const types = settings.measurementTypes;
  const typeId = types.some((t) => t.id === query.m) ? query.m : types[0]?.id;
  const type = types.find((t) => t.id === typeId);

  body.append(h('p', { class: 'muted small' }, 'Body measurements are optional. The app only records and charts the numbers you enter; it does not interpret them.'));

  // Add form
  const tSel = select(types.map((t) => [t.id, `${t.label} (${t.unit})`]), typeId, { 'aria-label': 'Measurement' });
  const val = numInput(null, { placeholder: 'Value', 'aria-label': 'Value' });
  const date = input({ type: 'date', value: isoDate(Date.now()), max: isoDate(Date.now()), 'aria-label': 'Date' });
  const note = input({ placeholder: 'Note (optional)', 'aria-label': 'Note', maxlength: 200 });
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const form = h('form', { class: 'card form', novalidate: true },
    h('h2', null, 'Add measurement'), err,
    h('div', { class: 'grid-2' }, field('Measurement', tSel), field('Value', val), field('Date', date), field('Note', note)),
    h('div', { class: 'form-actions' }, btn('Save measurement', null, { variant: 'primary', type: 'submit', icon: 'plus' }), btn('Manage types', manageTypes, { variant: 'ghost', icon: 'edit' })));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = num(val.value);
    const d = parseLocalDate(date.value);
    if (v === null || v <= 0) { err.textContent = 'Enter a positive number.'; err.hidden = false; val.focus(); return; }
    if (!d) { err.textContent = 'Enter a valid date.'; err.hidden = false; date.focus(); return; }
    const t = types.find((x) => x.id === tSel.value);
    // Use noon so the date does not shift across time zones.
    await store.saveMeasurement({ id: uid('mea'), typeId: t.id, date: d + 12 * 3600000, value: v, unit: t.unit, note: note.value.trim(), createdAt: Date.now() });
    toast(`${t.label} saved.`);
    setQuery({ m: t.id });
    ctx.rerender();
  });
  body.append(form);

  if (!type) return;
  const entries = store.state.measurements.filter((m) => m.typeId === typeId).sort((a, b) => a.date - b.date);
  const range = query.range || 'all';
  const from = rangeStart(range);
  const inRange = entries.filter((m) => m.date >= from);
  // Units are stored per entry; only entries in the type's current unit are charted together.
  const sameUnit = inRange.filter((m) => m.unit === type.unit);
  const typeSeg = segmented(types.map((t) => [t.id, t.label]), typeId, (v) => { setQuery({ m: v }); navigate(location.hash, { replace: true }); }, 'Measurement type');
  typeSeg.classList.add('scroll-x');
  const rangeSeg = segmented(RANGES, range, (v) => { setQuery({ range: v }); navigate(location.hash, { replace: true }); }, 'Date range');
  body.append(h('div', { class: 'card controls' }, h('div', { class: 'control-row' }, typeSeg, rangeSeg)));

  const points = sameUnit.map((m) => ({ x: m.date, y: m.value }));
  const left = h('div', null, chartPanel({ title: `${type.label}`, points, unit: type.unit, label: type.label, yFormat: (v) => fmtNum(v, 1), charts }), trendSummary(points, (v) => `${fmtNum(v, 1)} ${type.unit}`));
  if (typeId === 'bodyweight' && Number.isFinite(settings.targetBodyWeightKg) && points.length) {
    const latest = points[points.length - 1].y;
    const diff = latest - settings.targetBodyWeightKg;
    left.append(h('section', { class: 'card' }, h('h2', null, 'Goal'),
      h('p', null, `Target ${fmtNum(settings.targetBodyWeightKg, 1)} kg · latest ${fmtNum(latest, 1)} kg · `, Math.abs(diff) < 0.05 ? 'at target' : `${fmtNum(Math.abs(diff), 1)} kg ${diff > 0 ? 'above' : 'below'} target`),
      h('a', { href: '#/settings', class: 'link-sm' }, 'Change goal')));
  }
  const table = h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Entries'), h('span', { class: 'muted small' }, plural(inRange.length, 'entry', 'entries'))));
  if (!inRange.length) table.append(h('p', { class: 'muted small' }, 'No entries in this range.'));
  else {
    table.append(h('ul', { class: 'list' }, [...inRange].reverse().map((m) => h('li', { class: 'tpl-row' },
      h('span', { class: 'row-main' }, h('strong', null, `${fmtNum(m.value, 2)} ${m.unit}`), h('span', { class: 'muted small' }, `${fmtDate(m.date)}${m.note ? ` · ${m.note}` : ''}`)),
      iconBtn('trash', `Delete ${fmtNum(m.value, 2)} ${m.unit} from ${fmtDate(m.date)}`, async () => {
        if (await confirmDialog({ title: 'Delete measurement?', message: `${fmtNum(m.value, 2)} ${m.unit} on ${fmtDate(m.date)}`, confirmLabel: 'Delete', danger: true })) {
          await store.deleteMeasurement(m.id);
          ctx.rerender();
        }
      })))));
  }
  if (inRange.length !== sameUnit.length) table.append(h('p', { class: 'muted small' }, `${inRange.length - sameUnit.length} entries use a different unit and are not charted.`));
  body.append(h('div', { class: 'progress-grid' }, left, table));

  async function manageTypes() {
    const list = structuredClone(types);
    await openDialog({
      title: 'Measurement types',
      sheet: false,
      build: (close) => {
        const ul = h('ul', { class: 'list' });
        const label = input({ placeholder: 'e.g. Hips', 'aria-label': 'New measurement name', maxlength: 40 });
        const unit = input({ placeholder: 'e.g. cm', 'aria-label': 'Unit', maxlength: 12, class: 'w-num' });
        const draw = () => ul.replaceChildren(...list.map((t, i) => h('li', { class: 'tpl-row' },
          h('span', { class: 'row-main' }, h('strong', null, t.label), h('span', { class: 'muted small' }, t.unit)),
          ['bodyweight', 'waist'].includes(t.id) ? null : iconBtn('trash', `Remove ${t.label}`, () => {
            if (store.state.measurements.some((m) => m.typeId === t.id)) { toast('This type has entries. Delete them first.'); return; }
            list.splice(i, 1); draw();
          }))));
        draw();
        return h('div', { class: 'form' }, ul,
          h('div', { class: 'field-row' }, label, unit, btn('Add', () => {
            if (!label.value.trim() || !unit.value.trim()) { toast('Enter a name and a unit.'); return; }
            list.push({ id: uid('mt'), label: label.value.trim(), unit: unit.value.trim() });
            label.value = ''; unit.value = ''; draw();
          }, { icon: 'plus' })),
          h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Save', async () => { await store.saveSettings({ measurementTypes: list }); close(true); ctx.rerender(); }, { variant: 'primary' })));
      },
    });
  }
}
