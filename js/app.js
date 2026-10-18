// Application bootstrap: data loading, hash router, navigation, theme, timers and service worker.
// Hash routing keeps every URL relative, so the app works under any sub-path (e.g. GitHub Pages).

import { APP_VERSION } from './version.js';
import * as store from './store.js';
import { setVersionChangeHandler, requestPersistence } from './db.js';
import { h, clear, toast, btn } from './ui.js';
import { icon } from './icons.js';
import { fmtDuration } from './util.js';
import { sessionElapsedSec } from './model.js';
import { restRemainingMs } from './workout-logic.js';
import { isInstalledApp } from './device.js';
import { onTick, applyTheme, parseHash, setRouteHandler } from './shell.js';

import { renderHome } from './views/home.js';
import { renderTrain, renderProgram, renderTemplate } from './views/train.js';
import { renderLibrary, renderExercise } from './views/library.js';
import { renderWorkout } from './views/workout.js';
import { renderActivity } from './views/activity.js';
import { renderHistory, renderSession } from './views/history.js';
import { renderProgress } from './views/progress.js';
import { renderSettings } from './views/settings.js';

const ROUTES = [
  [/^\/$/, renderHome, 'home'],
  [/^\/train$/, renderTrain, 'train'],
  [/^\/train\/program\/([^/]+)$/, renderProgram, 'train'],
  [/^\/train\/template\/([^/]+)$/, renderTemplate, 'train'],
  [/^\/library$/, renderLibrary, 'train'],
  [/^\/library\/([^/]+)$/, renderExercise, 'train'],
  [/^\/workout$/, renderWorkout, 'workout'],
  [/^\/activity\/([^/]+)$/, renderActivity, 'train'],
  [/^\/history$/, renderHistory, 'history'],
  [/^\/history\/([^/]+)$/, renderSession, 'history'],
  [/^\/progress$/, renderProgress, 'progress'],
  [/^\/settings$/, renderSettings, 'settings'],
];

const NAV = [
  ['home', '#/', 'Home', 'home'],
  ['train', '#/train', 'Train', 'train'],
  ['history', '#/history', 'History', 'history'],
  ['progress', '#/progress', 'Progress', 'progress'],
  ['settings', '#/settings', 'Settings', 'settings'],
];

// ---------- router ----------

let cleanup = null;
let currentPath = null;

function route() {
  const { path, query } = parseHash();
  const view = document.getElementById('view');
  const match = ROUTES.map(([re, fn, nav]) => [re.exec(path), fn, nav]).find(([m]) => m);
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const isNewPath = path !== currentPath;
  currentPath = path;
  clear(view);
  if (!match) {
    view.append(h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'Page not found'), h('a', { href: '#/', class: 'btn btn-primary' }, 'Go home')));
    return;
  }
  const [m, fn, navKey] = match;
  setActiveNav(navKey);
  const ctx = {
    params: m.slice(1).map(decodeURIComponent),
    query,
    el: view,
    rerender: () => {
      const y = window.scrollY;
      if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
      clear(view);
      cleanup = fn({ ...ctx, query: parseHash().query }) || null;
      window.scrollTo(0, y);
    },
  };
  try {
    cleanup = fn(ctx) || null;
  } catch (e) {
    console.error(e);
    view.append(h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, 'Something went wrong'), h('p', { class: 'muted' }, String(e.message || e))));
  }
  if (isNewPath) {
    window.scrollTo(0, 0);
    const title = view.querySelector('h1');
    if (title) title.focus({ preventScroll: true });
  }
  updateActiveBar();
}

function setActiveNav(key) {
  for (const a of document.querySelectorAll('.nav a')) {
    if (a.dataset.nav === key || (key === 'workout' && a.dataset.nav === 'train')) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function buildNav() {
  const nav = document.getElementById('nav');
  clear(nav);
  nav.append(h('a', { class: 'brand', href: '#/', 'aria-label': 'Training Diary home' },
    h('img', { src: 'icons/icon.svg', alt: '', width: '32', height: '32' }), h('span', null, 'Training Diary')));
  const ul = h('ul');
  for (const [key, href, label, ic] of NAV) {
    ul.append(h('li', null, h('a', { href, dataset: { nav: key } }, icon(ic), h('span', null, label))));
  }
  nav.append(ul);
}

// ---------- active workout bar ----------

function updateActiveBar(now = Date.now()) {
  const bar = document.getElementById('active-bar');
  const s = store.activeSession();
  const onWorkout = parseHash().path === '/workout';
  if (!s || onWorkout) {
    bar.hidden = true;
    document.body.classList.remove('has-active-bar');
    return;
  }
  bar.hidden = false;
  document.body.classList.add('has-active-bar');
  const resting = s.rest && restRemainingMs(s.rest, now) > 0 && !s.pausedAt;
  const status = s.pausedAt ? 'Paused' : resting ? `Rest ${fmtDuration(Math.ceil(restRemainingMs(s.rest, now) / 1000))}` : fmtDuration(sessionElapsedSec(s, now));
  const label = bar.querySelector('.ab-label');
  if (!label) {
    clear(bar);
    bar.append(h('a', { href: '#/workout', class: 'ab-link' },
      h('span', { class: 'pulse', 'aria-hidden': 'true' }),
      h('span', { class: 'ab-text' }, h('span', { class: 'ab-label' }), h('span', { class: 'ab-status' })),
      h('span', { class: 'ab-cta' }, 'Resume', icon('forward'))));
  }
  bar.querySelector('.ab-label').textContent = s.name || 'Workout in progress';
  bar.querySelector('.ab-status').textContent = status;
}

// ---------- service worker ----------

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloading = false;
  let userAccepted = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !userAccepted) return;
    reloading = true;
    location.reload();
  });
  const showUpdate = (worker) => {
    const banner = document.getElementById('update-banner');
    clear(banner);
    banner.append(
      h('span', null, 'A new version of the app is available. Your data is kept.'),
      btn('Update now', () => { userAccepted = true; worker.postMessage({ type: 'SKIP_WAITING' }); }, { variant: 'primary', size: 'sm' }),
      btn('Later', () => { banner.hidden = true; }, { variant: 'ghost', size: 'sm' }));
    banner.hidden = false;
  };
  navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdate(w);
      });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch((e) => console.warn('Service worker registration failed', e));
}

// ---------- boot ----------

async function boot() {
  applyTheme();
  buildNav();
  document.getElementById('app-version').textContent = APP_VERSION;
  setVersionChangeHandler(() => {
    toast('The app was updated in another tab. Reload to continue.', { type: 'error', duration: 600000, action: { label: 'Reload', run: () => location.reload() } });
  });
  store.onSaveError((e) => toast(`Could not save: ${e?.message || e}`, { type: 'error', duration: 8000 }));
  try {
    const res = await store.loadAll();
    if (res.migratedFrom) toast(`Your data was upgraded from format version ${res.migratedFrom}.`);
  } catch (e) {
    console.error(e);
    const view = document.getElementById('view');
    clear(view);
    view.append(h('div', { class: 'empty' },
      h('p', { class: 'empty-title' }, 'Could not open local storage'),
      h('p', { class: 'muted' }, String(e.message || e)),
      h('p', { class: 'muted' }, 'Private browsing modes may block storage. Your existing data has not been changed.'),
      btn('Try again', () => location.reload(), { variant: 'primary' })));
    document.body.classList.remove('booting');
    return;
  }
  document.body.classList.remove('booting');
  setRouteHandler(route);
  window.addEventListener('hashchange', route);
  onTick(updateActiveBar);
  store.subscribe((what) => { if (what === 'sessions' || what === 'all') updateActiveBar(); });
  route();
  registerServiceWorker();
  // Ask the browser to treat our storage as persistent. Chrome and Safari never prompt; they
  // grant it silently, mainly to installed apps, so ask whenever that is likely to succeed.
  if (isInstalledApp() || store.completedSessions().length > 0) requestPersistence();
  window.addEventListener('appinstalled', () => { requestPersistence(); });
  const offline = document.getElementById('offline-pill');
  const updateOnline = () => { offline.hidden = navigator.onLine; };
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

boot();
