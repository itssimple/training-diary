// Settings: appearance, workout defaults, goals, reminders, data management and about.

import * as store from '../store.js';
import { h, btn, pageHead, field, numInput, input, select, segmented, checkbox, toast, confirmDialog, openDialog, readFileText, downloadFile } from '../ui.js';
import { icon } from '../icons.js';
import { getThemePref, setThemePref } from '../shell.js';
import { exportAll } from '../actions.js';
import { parseImport, mergeData } from '../backup.js';
import { buildWeeklyIcs } from '../ics.js';
import { storageInfo, requestPersistence } from '../db.js';
import { wakeLockSupported } from '../device.js';
import { APP_VERSION } from '../version.js';
import { num, fmtNum, plural, fmtDate } from '../util.js';

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
  const persistBtn = btn('Ask browser to keep data', async () => {
    const ok = await requestPersistence();
    toast(ok ? 'The browser will keep this data unless you clear it.' : 'The browser did not grant persistent storage. Regular exports are your safety net.');
    showStorage();
  }, { size: 'sm', variant: 'ghost' });
  async function showStorage() {
    const s = await storageInfo();
    const used = s.usage !== null ? `${fmtNum(s.usage / 1024 / 1024, 1)} MB used` : 'Usage unknown';
    storageEl.textContent = `${used}. Persistent storage: ${s.persisted === null ? 'unknown' : s.persisted ? 'granted' : 'not granted'}.`;
    persistBtn.hidden = s.persisted !== false;
  }
  showStorage();
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', 'aria-label': 'Choose backup file', onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); } });
  const lastExport = st.lastExportAt ? fmtDate(st.lastExportAt) : 'never';
  grid.append(section('Your data',
    h('p', { class: 'small' }, 'Everything is stored only in this browser on this device. Nothing is uploaded, synced or backed up automatically. Clearing browser data or uninstalling the app can delete it. Exporting a backup regularly is your responsibility.'),
    storageEl, persistBtn,
    h('p', { class: 'small' }, `Last export: ${lastExport}. ${plural(store.completedSessions().length, 'session')}, ${plural(store.state.exercises.length, 'exercise')}, ${plural(store.state.measurements.length, 'measurement')}.`),
    h('div', { class: 'form-actions' },
      btn('Export backup (JSON)', () => exportAll().then(rerender), { variant: 'primary', icon: 'download' }),
      btn('Import backup…', () => fileInput.click(), { icon: 'upload' })),
    fileInput));

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
