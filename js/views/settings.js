// Settings: appearance, workout defaults, goals, reminders, data management and about.

import * as store from '../store.js';
import { h, btn, pageHead, field, numInput, input, select, segmented, checkbox, toast, confirmDialog, openDialog, readFileText, downloadFile } from '../ui.js';
import { icon } from '../icons.js';
import { getThemePref, setThemePref } from '../shell.js';
import { exportAll, shareBackup } from '../actions.js';
import { buildCsvImport, exampleCsv } from '../csv-import.js';
import { parseImport, mergeData } from '../backup.js';
import { buildWeeklyIcs } from '../ics.js';
import { storageInfo, requestPersistence } from '../db.js';
import { wakeLockSupported, isInstalledApp } from '../device.js';
import { APP_VERSION } from '../version.js';
import { num, fmtNum, plural, fmtDate } from '../util.js';
import { sessionsSinceExport } from '../model.js';

const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

function section(title, ...children) {
  const id = `s-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return h('section', { class: 'card settings-section', 'aria-labelledby': id }, h('h2', { id }, title), children);
}

export function renderSettings({ el, rerender }) {
  const st = store.state.settings;
  el.append(pageHead('Settings'));
  const grid = h('div', { class: 'settings-grid' });
  el.append(grid);
  const saveNum = (key, inp, { min = 0, max = 100000, integer = false, nullable = false, label }) => async () => {
    const raw = inp.value.trim();
    let v = num(raw);
    if (raw === '' && nullable) v = null;
    else if (v === null || v < min || v > max) { toast(`${label} must be between ${min} and ${max}.`, { type: 'error' }); inp.value = st[key] ?? ''; return; }
    if (v !== null && integer) v = Math.round(v);
    await store.saveSettings({ [key]: v });
    toast('Saved.');
  };

  // Appearance
  const theme = segmented([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], getThemePref(), (v) => {
    setThemePref(v);
    for (const b of theme.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
  }, 'Theme');
  [...theme.querySelectorAll('button')].forEach((b, i) => { b.dataset.v = ['system', 'light', 'dark'][i]; });
  grid.append(section('Appearance', field('Theme', theme, { hint: 'System follows your device setting. Stored on this device only.' })));

  const modeSeg = segmented([['simple', 'Simple'], ['live', 'Live']], st.simpleLogging ? 'simple' : 'live', async (v) => {
    await store.saveSettings({ simpleLogging: v === 'simple' });
    for (const b of modeSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === v));
    toast(v === 'simple' ? 'Simple logging on: enter results after training.' : 'Live logging on: tick sets during the workout.');
  }, 'How you log workouts');
  [...modeSeg.querySelectorAll('button')].forEach((b, i) => { b.dataset.v = ['simple', 'live'][i]; });
  grid.append(section('How you log workouts',
    modeSeg,
    h('p', { class: 'small' }, h('strong', null, 'Simple: '), 'after training, open "Log this workout", adjust the weights and save. No timers or ticking sets.'),
    h('p', { class: 'small' }, h('strong', null, 'Live: '), 'start the workout at the gym and tick each set, with rest timer and suggestions.'),
    h('p', { class: 'muted small' }, 'This is a setting on this phone only. Both kinds of workouts end up in the same history and charts.')));

  // Workout
  const rest = numInput(st.defaultRestSec, { integer: true });
  rest.addEventListener('change', saveNum('defaultRestSec', rest, { min: 0, max: 3600, integer: true, label: 'Default rest' }));
  grid.append(section('Workout',
    field('Default rest between sets', rest, { unit: 'seconds', hint: 'Exercises and workout templates can override this.' }),
    checkbox('Sound when rest is over', st.restSound, (v) => store.saveSettings({ restSound: v })),
    checkbox('Vibrate when rest is over (Android)', st.restVibrate, (v) => store.saveSettings({ restVibrate: v })),
    checkbox(`Keep screen on during workouts${wakeLockSupported() ? '' : ' (not supported in this browser)'}`, st.keepScreenOn !== false, (v) => store.saveSettings({ keepScreenOn: v })),
    h('p', { class: 'muted small' }, 'Phones pause web apps in the background or when locked, so the rest alert only plays while the app is open on screen. The countdown itself stays correct and is recalculated when you return.')));

  // Goals
  // Training aids
  const effort = select([['off', 'Off'], ['rpe', 'RPE (6–10, how hard)'], ['rir', 'RIR (reps left in the tank)']], st.effortMode);
  effort.addEventListener('change', async () => { await store.saveSettings({ effortMode: effort.value }); toast('Saved.'); });
  const bar = numInput(st.barWeightKg);
  bar.addEventListener('change', saveNum('barWeightKg', bar, { min: 0, max: 50, label: 'Bar weight' }));
  const plates = input({ value: st.platesKg.map((p) => fmtNum(p)).join(', '), inputmode: 'decimal' });
  plates.addEventListener('change', async () => {
    const list = plates.value.split(/[;,\s]+/).map(num).filter((v) => Number.isFinite(v) && v > 0);
    if (!list.length) { toast('Enter plate sizes separated by commas, e.g. 25, 20, 10, 5, 2.5.', { type: 'error' }); plates.value = st.platesKg.join(', '); return; }
    const uniq = [...new Set(list)].sort((a, b) => b - a);
    await store.saveSettings({ platesKg: uniq });
    plates.value = uniq.map((p) => fmtNum(p)).join(', ');
    toast('Saved.');
  });
  grid.append(section('Training aids',
    field('Effort per set', effort, { hint: 'Adds an optional RPE or RIR column to strength sets.' }),
    checkbox('Progression hints (rep ranges): suggest the next weight when you reached the top of the range on every set last time', !!st.progressionHints, (v) => store.saveSettings({ progressionHints: v })),
    h('p', { class: 'muted small' }, 'Hints are suggestions only. Nothing changes unless you tap to apply it, and only for that workout.'),
    h('div', { class: 'grid-2' }, field('Barbell weight', bar, { unit: 'kg' }), field('Your plates', plates, { unit: 'kg', hint: 'Sizes available at your gym, comma separated.' }))));

  const goal = numInput(st.weeklyGoal, { integer: true });
  goal.addEventListener('change', saveNum('weeklyGoal', goal, { min: 0, max: 21, integer: true, label: 'Weekly goal' }));
  const dist = numInput(st.weeklyDistanceGoalKm, { placeholder: 'none' });
  dist.addEventListener('change', saveNum('weeklyDistanceGoalKm', dist, { min: 0, max: 2000, nullable: true, label: 'Weekly distance goal' }));
  const target = numInput(st.targetBodyWeightKg, { placeholder: 'none' });
  target.addEventListener('change', saveNum('targetBodyWeightKg', target, { min: 20, max: 400, nullable: true, label: 'Target body weight' }));
  const weekStart = select([[1, 'Monday'], [0, 'Sunday']], st.weekStart);
  weekStart.addEventListener('change', async () => { await store.saveSettings({ weekStart: Number(weekStart.value) }); toast('Saved.'); });
  grid.append(section('Goals',
    h('div', { class: 'grid-2' },
      field('Sessions per week', goal, { hint: '0 turns the weekly goal off.' }),
      field('Week starts on', weekStart),
      field('Weekly distance goal', dist, { unit: 'km', hint: 'Optional.' }),
      field('Target body weight', target, { unit: 'kg', hint: 'Optional, shown with body measurements.' })),
    checkbox('Count activities (runs, walks, rides) toward the weekly goal', st.countActivitiesInGoal !== false, (v) => store.saveSettings({ countActivitiesInGoal: v }))));

  // Reminders
  const days = new Set(st.reminderDays || []);
  const dayChips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Training days' }, WEEKDAYS.map(([d, l]) => h('button', {
    type: 'button', class: 'chip', 'aria-pressed': String(days.has(d)),
    onclick: async (e) => { if (days.has(d)) days.delete(d); else days.add(d); e.currentTarget.setAttribute('aria-pressed', String(days.has(d))); await store.saveSettings({ reminderDays: [...days] }); },
  }, l)));
  const time = input({ type: 'time', value: st.reminderTime || '17:30' });
  time.addEventListener('change', () => store.saveSettings({ reminderTime: time.value }));
  grid.append(section('Reminders',
    h('p', { class: 'small' }, 'Pick your usual training days. The Home screen highlights them and shows what is left of your weekly goal.'),
    field('Training days', dayChips),
    field('Usual time', time),
    h('p', { class: 'notice small' }, icon('info'), h('span', null, 'This app has no server, so it cannot send notifications while it is closed. For real reminders, add the schedule to your phone’s calendar below. Your calendar app then handles the alerts.')),
    btn('Add to calendar (.ics)', () => {
      try {
        const ics = buildWeeklyIcs({ days: [...days], time: time.value, title: 'Training', description: 'Planned training session (from Training Diary).' });
        downloadFile('training-reminders.ics', ics, 'text/calendar');
        toast('Calendar file created. Open it to add the recurring events to your calendar.');
      } catch (e) { toast(e.message, { type: 'error' }); }
    }, { icon: 'calendar' })));

  // Data
  const storageEl = h('p', { class: 'small muted' }, 'Checking storage…');
  const installed = isInstalledApp();
  // Chrome and Safari never show a prompt for this: they decide silently, mostly based on
  // whether the app is installed (and, in Chrome, how much it is used). Firefox asks.
  const persistHelp = h('p', { class: 'notice small', hidden: true }, icon('info'), h('span', null, installed
    ? 'Your browser has not granted persistent storage yet. Most browsers do not ask you; they decide on their own, for example based on how often you use the app. The app asks again automatically. Your data is still saved, but keep exporting backups.'
    : 'Most browsers never show a question for this. They decide on their own and usually only grant it to apps installed on the home screen. Install the app (Android: browser menu → Install app; iPhone: Safari → Share → Add to Home Screen) and open it from the home screen. On iPhone this matters even more: in a Safari tab, Safari deletes the data after 7 days of using Safari without opening this app. Apps added to the Home Screen are exempt.'));
  const persistBtn = btn('Ask browser to keep data', async () => {
    const ok = await requestPersistence();
    toast(ok ? 'Granted: the browser will keep this data unless you clear it yourself.' : 'Not granted. The browser decided without asking. See the note below.', { duration: 6000 });
    showStorage();
  }, { size: 'sm', variant: 'ghost' });
  async function showStorage() {
    const s = await storageInfo();
    const used = s.usage !== null ? `${fmtNum(s.usage / 1024 / 1024, 1)} MB used` : 'Usage unknown';
    storageEl.textContent = `${used}. Persistent storage: ${s.persisted === null ? 'not supported by this browser' : s.persisted ? 'granted' : 'not granted'}.`;
    persistBtn.hidden = s.persisted !== false;
    persistHelp.hidden = s.persisted !== false;
  }
  showStorage();
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', 'aria-label': 'Choose backup file', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });
  const lastExport = st.lastExportAt ? fmtDate(st.lastExportAt) : 'never';
  const backupEvery = numInput(st.backupEvery, { integer: true });
  backupEvery.addEventListener('change', saveNum('backupEvery', backupEvery, { min: 1, max: 100, integer: true, label: 'Backup reminder' }));
  grid.append(section('Your data',
    h('p', { class: 'small' }, 'Everything is stored only in this browser on this device. Nothing is uploaded, synced or backed up automatically. Clearing browser data or uninstalling the app can delete it. Exporting a backup regularly is your responsibility.'),
    storageEl, persistHelp, persistBtn,
    h('p', { class: 'small' }, `Last export: ${lastExport}. ${plural(store.completedSessions().length, 'session')}, ${plural(store.state.exercises.length, 'exercise')}, ${plural(store.state.measurements.length, 'measurement')}.`),
    h('div', { class: 'form-actions' },
      btn('Back up now', () => shareBackup().then(rerender), { variant: 'primary', icon: 'upload' }),
      btn('Download backup (JSON)', () => exportAll().then(rerender), { icon: 'download' }),
      btn('Restore backup…', () => fileInput.click(), { icon: 'reset' })),
    h('p', { class: 'muted small' }, '"Back up now" opens the share sheet where your browser supports it (save to iCloud Drive, Google Drive, email…), otherwise it downloads the file.'),
    field('Remind me to back up after', backupEvery, { unit: 'new sessions', hint: `${plural(sessionsSinceExport(store.state.sessions, st), 'session')} since the last backup.` }),
    fileInput));

  // Import history from other diaries
  const csvInput = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', class: 'sr-only', 'aria-label': 'Choose CSV file', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCsv(f); } });
  grid.append(section('Import training history',
    h('p', { class: 'small' }, 'Bring in workouts from an old diary or another app. Two ways:'),
    h('ul', { class: 'small' },
      h('li', null, h('strong', null, 'Paper diary: '), 'History → "Past workout", one workout at a time.'),
      h('li', null, h('strong', null, 'Spreadsheet or app export (CSV): '), 'one row per set. Download the template to see the columns. Column names from Strong and Hevy exports are recognised too, but that has not been tested with real exports.')),
    h('div', { class: 'form-actions' },
      btn('Import CSV…', () => csvInput.click(), { variant: 'primary', icon: 'upload' }),
      btn('Download CSV template', () => downloadFile('training-diary-template.csv', exampleCsv(), 'text/csv'), { icon: 'download' })),
    csvInput));

  grid.append(section('Danger zone',
    h('p', { class: 'small' }, 'Delete all workouts, activities, programs, exercises, measurements and settings on this device. Starter exercises are recreated afterwards.'),
    btn('Delete all data…', async () => {
      const ok = await confirmDialog({
        title: 'Delete all data?',
        message: h('div', null, h('p', null, 'This permanently deletes everything stored by this app on this device. It cannot be undone.'), h('p', { class: 'small' }, 'Consider exporting a backup first.')),
        confirmLabel: 'Delete everything', danger: true, requireText: 'DELETE',
      });
      if (!ok) return;
      await store.wipeAll();
      toast('All data deleted.');
      location.hash = '#/';
    }, { variant: 'danger', icon: 'trash' })));

  // About
  grid.append(section('About',
    h('p', { class: 'small' }, `Training Diary ${APP_VERSION}. An offline-first, private workout diary. No accounts, no tracking, no analytics. Not affiliated with any gym chain.`),
    h('p', { class: 'small' }, 'Works offline after the first visit. Updates download in the background; you will be asked before switching.'),
    h('p', { class: 'small' }, 'Charts use ', h('a', { href: 'vendor/chartjs/LICENSE.md', target: '_blank', rel: 'noopener' }, 'Chart.js (MIT licence)'), ', bundled with the app.'),
    btn('Check for updates', async () => {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (!reg) { toast('Offline support is not active in this browser.'); return; }
      try { await reg.update(); toast(reg.installing || reg.waiting ? 'Update found. Follow the banner to install it.' : 'You have the latest version.'); } catch { toast('Could not check for updates (offline?).'); }
    }, { size: 'sm', variant: 'ghost', icon: 'reset' })));

  async function importCsv(file, weightUnit = 'kg') {
    let text;
    try { text = await readFileText(file); } catch (e) { toast(e.message, { type: 'error' }); return; }
    const r = buildCsvImport(text, { exercises: store.state.exercises, sessions: store.state.sessions, weightUnit, fileName: file.name });
    if (!r.ok) {
      await openDialog({
        title: 'CSV import failed', sheet: false,
        build: (close) => h('div', null, h('p', null, 'Nothing was imported.'),
          h('ul', { class: 'error-list' }, [...r.errors, ...(r.skipped || []).slice(0, 20)].map((x) => h('li', null, x))),
          h('div', { class: 'dialog-actions' }, btn('Close', () => close(), { variant: 'primary' }))),
      });
      return;
    }
    const s = r.stats;
    const choice = await openDialog({
      title: 'Import training history', sheet: false,
      build: (close) => h('div', null,
        h('p', null, s.workouts
          ? `${plural(s.workouts, 'workout')} with ${plural(s.sets, 'set')}, from ${fmtDate(s.from)} to ${fmtDate(s.to)}.`
          : 'All workouts in this file are already in your diary.'),
        s.duplicates ? h('p', { class: 'small' }, `${plural(s.duplicates, 'workout')} already imported earlier will be skipped.`) : null,
        r.newExercises.length ? h('details', { open: true }, h('summary', null, `${plural(r.newExercises.length, 'new exercise')} will be added to your library`),
          h('ul', { class: 'small' }, r.newExercises.map((e) => h('li', null, `${e.name} (${e.type})`))),
          h('p', { class: 'muted small' }, 'Check them afterwards in Train → Exercises: set equipment, per-hand weight or lower-is-better where needed.')) : null,
        r.skipped.length ? h('details', null, h('summary', null, `${plural(r.skipped.length, 'row')} skipped`), h('ul', { class: 'error-list' }, r.skipped.slice(0, 50).map((x) => h('li', null, x)))) : null,
        r.warnings.length ? h('p', { class: 'muted small' }, r.warnings.join(' ')) : null,
        h('p', { class: 'small' }, `Weights read as ${weightUnit === 'lb' ? 'pounds (converted to kg)' : 'kilograms'}. `,
          h('button', { type: 'button', class: 'linklike', onclick: () => close(weightUnit === 'lb' ? 'kg' : 'lb') }, weightUnit === 'lb' ? 'They are in kg' : 'They are in lb')),
        h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }),
          s.workouts ? btn(`Import ${plural(s.workouts, 'workout')}`, () => close('import'), { variant: 'primary' }) : null)),
    });
    if (choice === 'kg' || choice === 'lb') { importCsv(file, choice); return; }
    if (choice !== 'import') return;
    try {
      await store.importBundle({ exercises: r.newExercises, sessions: r.sessions });
      toast(`Imported ${plural(s.workouts, 'workout')}.`);
      rerender();
    } catch (e) {
      toast(`Import failed, nothing was changed: ${e.message}`, { type: 'error', duration: 8000 });
    }
  }

  async function importFile(file) {
    let text;
    try { text = await readFileText(file); } catch (e) { toast(e.message, { type: 'error' }); return; }
    const res = parseImport(text);
    if (!res.ok) {
      await openDialog({
        title: 'Import failed', sheet: false,
        build: (close) => h('div', null,
          h('p', null, 'Nothing was changed. The file could not be imported because:'),
          h('ul', { class: 'error-list' }, res.errors.map((e) => h('li', null, e))),
          h('div', { class: 'dialog-actions' }, btn('Close', () => close(), { variant: 'primary' }))),
      });
      return;
    }
    const c = res.counts;
    const mode = await openDialog({
      title: 'Import backup', sheet: false,
      build: (close) => h('div', null,
        h('p', null, `File from ${res.exportedAt ? fmtDate(Date.parse(res.exportedAt)) : 'unknown date'} contains ${plural(c.sessions, 'session')}, ${plural(c.exercises, 'exercise')}, ${plural(c.programs, 'program')}, ${plural(c.templates, 'workout template')} and ${plural(c.measurements, 'measurement')}.`),
        res.warnings.length ? h('details', null, h('summary', null, `${plural(res.warnings.length, 'warning')}`), h('ul', { class: 'error-list' }, res.warnings.map((w) => h('li', null, w)))) : null,
        h('p', { class: 'small' }, h('strong', null, 'Merge'), ' adds the records from the file and updates records with the same id. Your settings are kept.'),
        h('p', { class: 'small' }, h('strong', null, 'Replace'), ' deletes all current data on this device and uses the file instead.'),
        h('div', { class: 'dialog-actions' }, btn('Cancel', () => close(), { variant: 'ghost' }), btn('Replace all', () => close('replace'), { variant: 'danger' }), btn('Merge', () => close('merge'), { variant: 'primary' }))),
    });
    if (!mode) return;
    try {
      if (mode === 'replace') {
        const ok = await confirmDialog({ title: 'Replace all data?', message: 'All current data on this device will be replaced by the backup. Export first if you are unsure.', confirmLabel: 'Replace', danger: true });
        if (!ok) return;
        await store.replaceAll({ ...res.data, settings: res.data.settings || store.state.settings });
        toast('Backup imported.');
      } else {
        const merged = mergeData(store.snapshotData(), res.data);
        await store.replaceAll(merged.data);
        toast(`Backup merged.${merged.skippedActive ? ` ${plural(merged.skippedActive, 'unfinished workout')} from the file skipped because one is in progress here.` : ''}`, { duration: 6000 });
      }
      rerender();
    } catch (e) {
      toast(`Import failed, your existing data is unchanged: ${e.message}`, { type: 'error', duration: 8000 });
    }
  }
}
