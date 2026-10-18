// End-to-end tests of the critical workflows in headless Chromium, served under the
// GitHub Pages sub-path (/training-diary/). Requires Playwright (not a project dependency).
// Usage: node tests/e2e/run.mjs [--shots=DIR]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPlaywright } from './playwright.mjs';
import { startServer } from '../serve.mjs';

const PORT = 8093;
const BASE = `http://localhost:${PORT}/training-diary/`;
const shotsArg = process.argv.find((a) => a.startsWith('--shots='));
const SHOTS = shotsArg ? shotsArg.slice(8) : null;
if (SHOTS) await mkdir(SHOTS, { recursive: true });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push([true, name]);
    console.log(`ok   ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push([false, name, e]);
    console.log(`FAIL ${name}\n     ${String(e.message || e).split('\n').slice(0, 6).join('\n     ')}`);
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }); }

const server = await startServer(PORT);
const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

const go = async (hash) => { await page.goto(`${BASE}${hash}`); await page.waitForSelector('body:not(.booting)'); await page.waitForTimeout(150); };
const dialog = () => page.locator('dialog[open]');
const tmp = join(tmpdir(), `td-e2e-${Date.now()}`);
await mkdir(tmp, { recursive: true });

await step('1. first launch: starter content and suggested workout', async () => {
  await go('');
  await page.waitForSelector('text=Up next');
  expect(await page.locator('#next-title').innerText() === 'Full body A', 'suggests Full body A');
  await go('#/library');
  expect(/\d+ exercises/.test(await page.locator('.md-list .muted.small').first().innerText()), 'library lists exercises');
  await shot(page, '01-home');
});

await step('2. add and edit an exercise', async () => {
  await go('#/library/new');
  await page.getByLabel('Name', { exact: true }).fill('Test cable fly');
  const form = page.locator('.md-detail form');
  await form.getByLabel('Category').selectOption('Chest');
  await form.getByLabel('Equipment').selectOption('Cable');
  await page.getByRole('button', { name: 'Create exercise' }).click();
  await page.waitForSelector('h1:has-text("Test cable fly")');
  await page.getByLabel('Name', { exact: true }).fill('Test cable fly (low)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForSelector('h1:has-text("Test cable fly (low)")');
  await page.reload();
  await page.waitForSelector('h1:has-text("Test cable fly (low)")');
  // duplicate names are rejected
  await go('#/library/new');
  await page.getByLabel('Name', { exact: true }).fill('test cable fly (LOW)');
  await page.getByRole('button', { name: 'Create exercise' }).click();
  await page.waitForSelector('.form-error:has-text("already exists")');
});

await step('3. create a program and workout template', async () => {
  await go('#/train');
  await page.getByRole('button', { name: 'New program' }).first().click();
  await page.waitForSelector('h1:has-text("New program")');
  await page.getByLabel('Program name').fill('Upper / Lower');
  await page.getByLabel('Program name').press('Tab');
  await page.waitForSelector('text=Saved.');
  await page.getByRole('button', { name: 'Add workout' }).click();
  await page.waitForSelector('text=Workout name');
  await page.getByLabel('Workout name').fill('Upper day');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await dialog().getByLabel('Search exercises').fill('test cable');
  await dialog().locator('.pick-row', { hasText: 'Test cable fly (low)' }).click();
  await page.waitForSelector('.tpl-item:has-text("Test cable fly (low)")');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await dialog().getByLabel('Search exercises').fill('lat pulldown');
  await dialog().locator('.pick-row', { hasText: 'Lat pulldown' }).click();
  await page.waitForSelector('.tpl-item:has-text("Lat pulldown")');
  // Link the two as a superset
  await page.getByRole('button', { name: 'More actions for Test cable fly (low)' }).click();
  await dialog().getByRole('button', { name: 'Link with next as superset' }).click();
  await page.waitForSelector('.group-box');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.group-box .tpl-item:has-text("Lat pulldown")');
  expect(await page.getByLabel('Workout name').inputValue() === 'Upper day', 'template name persisted');
  await go('#/train');
  await page.waitForSelector('.program-card:has-text("Upper / Lower"):has-text("Upper day")');
  await shot(page, '03-train');
});

let sessionUrl;
await step('4. start a workout from a template and record sets', async () => {
  await go('');
  await page.getByRole('button', { name: 'Start workout' }).click();
  await page.waitForURL(/#\/workout/);
  await page.waitForSelector('.entry-title:has-text("Leg press")');
  const first = page.locator('.wk-detail .set-row:not(.set-head)').first();
  await first.getByLabel(/Set 1 kg/).fill('100');
  await first.getByRole('button', { name: 'Mark set 1 done' }).click();
  await page.waitForSelector('.wk-detail .check-btn.on');
  await page.waitForSelector('.rest-dock:not([hidden])');
  expect((await page.locator('.rest-label').innerText()).startsWith('Rest'), 'rest timer running');
  // second set: placeholder suggests the previous set (100 kg); ticking uses it
  const second = page.locator('.wk-detail .set-row:not(.set-head)').nth(1);
  expect(await second.getByLabel(/Set 2 kg/).getAttribute('placeholder') === '100', 'suggests previous weight');
  await second.getByRole('button', { name: 'Mark set 2 done' }).click();
  await page.waitForSelector('.wk-detail .check-btn.on >> nth=1');
  await page.getByRole('button', { name: 'Skip rest' }).click();
  await page.waitForSelector('.rest-dock', { state: 'hidden' });
  await shot(page, '04-workout');
});

await step('5. substitute an exercise (machine occupied)', async () => {
  await page.locator('.ov-btn', { hasText: 'Chest press machine' }).click();
  await page.getByRole('button', { name: 'Swap Chest press machine' }).click();
  await dialog().locator('.list-label', { hasText: 'Suggested alternatives' }).waitFor();
  await dialog().locator('.pick-row', { hasText: 'Dumbbell bench press' }).first().click();
  await page.waitForSelector('.swap-note:has-text("Replaces planned Chest press machine")');
  const row = page.locator('.wk-detail .set-row:not(.set-head)').first();
  await row.getByLabel(/Set 1 kg/).fill('22');
  await row.getByRole('button', { name: 'Mark set 1 done' }).click();
  await page.waitForSelector('.wk-detail .check-btn.on');
});

await step('6. record a superset (no rest between, rest after round)', async () => {
  await page.locator('.ov-btn', { hasText: 'Lateral raise' }).click();
  await page.waitForSelector('.unit-card.is-group');
  const entries = page.locator('.wk-detail .entry');
  expect(await entries.count() === 2, 'superset shows both exercises');
  await entries.nth(0).getByLabel(/Set 1 kg/).fill('8');
  await entries.nth(0).getByRole('button', { name: 'Mark set 1 done' }).click();
  await page.waitForSelector('.wk-detail .entry.current .entry-title:has-text("Face pull")');
  expect(!(await page.locator('.rest-dock').isVisible().catch(() => false)), 'no rest between superset exercises');
  await page.locator('.wk-detail .entry').nth(1).getByLabel(/Set 1 kg/).fill('20');
  await page.locator('.wk-detail .entry').nth(1).getByRole('button', { name: 'Mark set 1 done' }).click();
  await page.waitForSelector('.rest-dock:not([hidden])');
  expect(/Round 2 of 3/.test(await page.locator('.unit-card .group-head').innerText()), 'round counter advanced');
  await shot(page, '06-superset');
});

await step('7. pause and resume', async () => {
  await page.getByRole('button', { name: 'Pause workout' }).click();
  await page.waitForSelector('.paused-banner');
  const t1 = await page.locator('.big-timer').innerText();
  await page.waitForTimeout(2200);
  expect(await page.locator('.big-timer').innerText() === t1, 'timer stopped while paused');
  await page.locator('.paused-banner').getByRole('button', { name: 'Resume' }).click();
  await page.waitForSelector('.paused-banner', { state: 'detached' });
});

await step('8. refresh during an active workout keeps everything', async () => {
  await page.reload();
  await page.waitForSelector('.unit-card.is-group');
  expect(await page.locator('.wk-detail .check-btn.on').count() === 2, 'superset sets still done');
  await page.waitForSelector('.ov-btn:has-text("Dumbbell bench press")');
  await go('');
  await page.waitForSelector('text=Resume workout');
  await page.waitForSelector('.active-bar:not([hidden])');
});

await step('9. finish workout and view it in history', async () => {
  await go('#/workout');
  await page.locator('.finish-btn').click();
  await dialog().getByLabel('Notes').fill('Good session');
  await dialog().getByRole('button', { name: 'Save workout' }).click();
  await page.waitForURL(/#\/history\/ses_/);
  sessionUrl = page.url().split('?')[0];
  await page.waitForSelector('text=Workout saved');
  await page.waitForSelector('text=planned Chest press machine, performed Dumbbell bench press');
  const legRows = page.locator('.entry-detail', { hasText: 'Leg press' }).locator('tbody tr');
  expect(await legRows.count() === 3, 'leg press shows 3 planned sets');
  await shot(page, '09-history-detail');
});

await step('9b. editing the template never rewrites the recorded session', async () => {
  await go('#/train/template/tpl_starter_a');
  const sets = page.locator('.tpl-item', { hasText: 'Leg press' }).getByLabel('Sets');
  await sets.fill('5');
  await page.waitForTimeout(700);
  await page.goto(sessionUrl);
  await page.waitForSelector('.entry-detail');
  const legRows = page.locator('.entry-detail', { hasText: 'Leg press' }).locator('tbody tr');
  expect(await legRows.count() === 3, 'still 3 sets in history');
});

await step('10. log a cardio activity', async () => {
  await go('#/activity/new');
  await page.getByLabel('Minutes').fill('30');
  await page.getByLabel('Distance').fill('5,0');
  await page.waitForSelector('text=Average pace 6:00 /km');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await page.waitForURL(/#\/history\/ses_/);
  await page.waitForSelector('.stat:has-text("min/km")');
  // a second run a week earlier, to get a trend
  await go('#/activity/new');
  const d = new Date(Date.now() - 7 * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  await page.getByLabel('Date and time').fill(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T07:30`);
  await page.getByLabel('Minutes').fill('33');
  await page.getByLabel('Distance').fill('5');
  await page.getByRole('button', { name: 'Save activity' }).click();
  await page.waitForURL(/#\/history\/ses_/);
});

await step('11. progress charts and empty states', async () => {
  await go('#/progress?tab=cardio');
  await page.waitForSelector('.chart-box canvas');
  await page.waitForFunction(() => window.Chart && Object.keys(window.Chart.instances || {}).length > 0);
  await shot(page, '11-cardio');
  await go('#/progress?tab=strength');
  await page.waitForSelector('text=Not enough data for a trend yet');
  await go('#/progress?tab=records');
  await page.waitForSelector('.record-card:has-text("Running")');
  await go('#/progress?tab=body');
  await page.getByLabel('Value').fill('80,4');
  await page.getByRole('button', { name: 'Save measurement' }).click();
  await page.waitForSelector('text=80.4 kg');
});

let exportPath;
await step('12. export and import data', async () => {
  await go('#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup (JSON)' }).click()]);
  exportPath = join(tmp, 'backup.json');
  await dl.saveAs(exportPath);
  const json = JSON.parse(await readFile(exportPath, 'utf8'));
  expect(json.format === 'training-diary-export' && json.data.sessions.length === 3, `export has 3 sessions (got ${json.data.sessions.length})`);
  await page.locator('input[type=file]').setInputFiles(exportPath);
  await dialog().getByRole('button', { name: 'Replace all' }).click();
  await dialog().getByRole('button', { name: 'Replace' }).click();
  await page.waitForSelector('text=Backup imported.');
  await go('#/history');
  expect(await page.locator('.hist-row').count() === 3, 'history has 3 sessions after replace import');
});

await step('13. invalid import is rejected and data is untouched', async () => {
  const bad = JSON.parse(await readFile(exportPath, 'utf8'));
  bad.data.sessions[0].startedAt = 'yesterday';
  const badPath = join(tmp, 'bad.json');
  await writeFile(badPath, JSON.stringify(bad));
  await go('#/settings');
  await page.locator('input[type=file]').setInputFiles(badPath);
  await dialog().locator('text=Import failed').waitFor();
  expect(/startedAt/.test(await dialog().innerText()), 'error names the field');
  await dialog().locator('.dialog-actions button', { hasText: 'Close' }).click();
  await writeFile(badPath, '{ nope');
  await page.locator('input[type=file]').setInputFiles(badPath);
  await dialog().locator('text=not valid JSON').waitFor();
  await dialog().locator('.dialog-actions button', { hasText: 'Close' }).click();
  await go('#/history');
  expect(await page.locator('.hist-row').count() === 3, 'still 3 sessions');
});

await step('14/15. offline launch from the GitHub Pages sub-path', async () => {
  await go('');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.waitForSelector('body:not(.booting) h1');
  await page.waitForSelector('#offline-pill:not([hidden])');
  await go('#/progress?tab=cardio');
  await page.waitForSelector('.chart-box canvas');
  await go('#/history');
  expect(await page.locator('.hist-row').count() === 3, 'history works offline');
  await shot(page, '14-offline');
  await context.setOffline(false);
});

await step('16. theme switching and wide layout', async () => {
  await go('#/settings');
  await page.getByRole('button', { name: 'Dark' }).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark applied');
  await page.reload();
  await page.waitForSelector('body:not(.booting)');
  expect(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark persisted');
  await page.setViewportSize({ width: 884, height: 840 }); // roughly an unfolded foldable
  await go('#/history');
  await page.locator('.hist-row').first().click();
  await page.waitForSelector('.md.has-detail .md-list .hist-row');
  expect(await page.locator('.md-list').isVisible(), 'list stays visible beside detail on wide screens');
  await shot(page, '16-wide-history');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(100);
  expect(!(await page.locator('.md-list').isVisible()), 'narrow shows detail only');
  await page.getByRole('button', { name: 'Light' }).isVisible().catch(() => {});
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(!overflow, 'no horizontal scroll on narrow screen');
});

await step('17. discard workout and delete all data require confirmation', async () => {
  await go('');
  await page.getByRole('button', { name: 'Empty workout' }).click();
  await page.waitForURL(/#\/workout/);
  await dialog().locator('.pick-row', { hasText: 'Plank' }).first().click();
  await page.getByRole('button', { name: 'Workout options' }).click();
  await dialog().getByRole('button', { name: 'Discard workout' }).click();
  await dialog().getByRole('button', { name: 'Discard workout' }).click();
  await page.waitForSelector('text=Workout discarded.');
  await go('#/settings');
  await page.getByRole('button', { name: 'Delete all data…' }).click();
  const confirmBtn = dialog().getByRole('button', { name: 'Delete everything' });
  expect(await confirmBtn.isDisabled(), 'needs typed confirmation');
  await dialog().getByLabel('Type DELETE to confirm').fill('DELETE');
  await confirmBtn.click();
  await page.waitForSelector('text=All data deleted.');
  await go('#/history');
  await page.waitForSelector('text=No history yet');
});

await step('no "null"/"undefined"/"NaN" text on any screen', async () => {
  const leaked = async () => page.evaluate(() => {
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (/\b(null|undefined|NaN)\b/.test(n.nodeValue) && n.parentElement?.closest('script,style,noscript') === null) out.push(n.nodeValue.trim().slice(0, 60));
    }
    return out;
  });
  const routes = ['', '#/train', '#/library', '#/library/new', '#/library/ex_bench_press', '#/history', '#/progress', '#/progress?tab=cardio', '#/progress?tab=records', '#/progress?tab=body', '#/settings', '#/activity/new', '#/train/template/tpl_starter_a', '#/train/program/prg_starter'];
  for (const r of routes) {
    await go(r);
    const found = await leaked();
    expect(!found.length, `${r || 'home'}: ${found.join(' | ')}`);
  }
  // The compact "create exercise" form inside the exercise picker (adding to a program/template).
  await go('#/train/template/tpl_starter_a');
  await page.getByRole('button', { name: 'Add exercise' }).click();
  await dialog().getByRole('button', { name: 'Create new exercise' }).click();
  await dialog().getByRole('button', { name: 'Create exercise' }).waitFor();
  const found = await leaked();
  expect(!found.length, `exercise picker create form: ${found.join(' | ')}`);
  await dialog().getByRole('button', { name: 'Close' }).first().click();
});

await step('no uncaught page errors', async () => {
  const real = errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED|Failed to fetch|Failed to load resource/.test(e));
  expect(real.length === 0, real.join('\n'));
});

await browser.close();
server.close();
const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length}/${results.length} e2e steps passed`);
process.exit(failed.length ? 1 : 0);
