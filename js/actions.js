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
  toast('Backup file saved to your downloads. Copy it somewhere safe (cloud drive or email to yourself).', { duration: 6000 });
}

/**
 * Back up via the system share sheet (iCloud Drive, Google Drive, email…) where the browser
 * allows sharing this file type; otherwise falls back to a normal download.
 */
export async function shareBackup() {
  const json = JSON.stringify(buildExport(store.snapshotData(), APP_VERSION), null, 2);
  let file = null;
  try { file = new File([json], exportFileName(), { type: 'application/json' }); } catch { /* old browser */ }
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Training Diary backup' });
      await store.saveSettings({ lastExportAt: Date.now() });
      toast('Backup shared.');
      return;
    } catch (e) {
      if (e?.name === 'AbortError') { toast('Backup cancelled. Nothing was saved.'); return; }
    }
  }
  await exportAll();
}

/** A completed workout in the past (forgotten log or old paper diary), opened for ticking sets. */
export async function createPastWorkout({ templateId, startedAt, durationMin }) {
  const tpl = templateId ? store.templateById(templateId) : null;
  const exMap = new Map(store.state.exercises.map((e) => [e.id, e]));
  const s = tpl ? W.createSessionFromTemplate(tpl, store.programById(tpl.programId), exMap, startedAt) : W.createEmptySession(startedAt);
  s.status = 'completed';
  s.endedAt = startedAt + Math.round(durationMin || 0) * 60000;
  s.createdAt = Date.now();
  s.updatedAt = Date.now();
  s.loggedAfterwards = true;
  await store.saveSession(s);
  navigate(`#/history/${s.id}?edit=1`);
  toast(tpl ? 'Tick the sets you did and adjust the values.' : 'Add the exercises you did, then tick the sets.', { duration: 6000 });
}
