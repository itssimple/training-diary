// Cross-view actions (starting workouts, exporting) so views stay focused on rendering.

import * as store from './store.js';
import * as W from './workout-logic.js';
import { confirmDialog, toast, downloadFile } from './ui.js';
import { navigate } from './shell.js';
import { buildExport, exportFileName } from './backup.js';
import { APP_VERSION } from './version.js';

async function okToStartNew() {
  const active = store.activeSession();
  if (!active) return true;
  const go = await confirmDialog({
    title: 'Workout already in progress',
    message: `"${active.name}" is still in progress. Resume it instead, or discard it and start a new workout?`,
    confirmLabel: 'Discard and start new',
    cancelLabel: 'Keep current',
    danger: true,
  });
  if (!go) { navigate('#/workout'); return false; }
  await store.deleteSession(active.id);
  return true;
}

export async function startFromTemplate(templateId) {
  const tpl = store.templateById(templateId);
  if (!tpl) { toast('That workout template no longer exists.', { type: 'error' }); return; }
  if (!(await okToStartNew())) return;
  const program = store.programById(tpl.programId);
  const exMap = new Map(store.state.exercises.map((e) => [e.id, e]));
  const s = W.createSessionFromTemplate(tpl, program, exMap, Date.now());
  await store.saveSession(s);
  navigate('#/workout');
}

export async function startEmptyWorkout() {
  if (!(await okToStartNew())) return;
  const s = W.createEmptySession(Date.now());
  s.name = 'Workout';
  await store.saveSession(s);
  navigate('#/workout?add=1');
}

export async function exportAll() {
  const data = buildExport(store.snapshotData(), APP_VERSION);
  downloadFile(exportFileName(), JSON.stringify(data, null, 2));
  await store.saveSettings({ lastExportAt: Date.now() });
  toast('Backup file created. Keep it somewhere safe (e.g. cloud drive or email to yourself).');
}
