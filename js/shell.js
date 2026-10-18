// Shared shell services used by views: ticker, theme and navigation helpers.
// Kept separate from app.js so views do not import the bootstrap module.

// ---------- shared 1 s ticker (values are always computed from timestamps) ----------

const tickers = new Set();
export function onTick(fn) { tickers.add(fn); return () => tickers.delete(fn); }
function tick() { for (const fn of tickers) { try { fn(Date.now()); } catch (e) { console.error(e); } } }
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

// ---------- theme ----------

const THEME_KEY = 'td-theme';
export function getThemePref() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}
export function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch { /* storage unavailable */ }
  applyTheme();
}
export function applyTheme() {
  const pref = getThemePref();
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#111518' : '#f4f6f3');
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- navigation ----------

let routeHandler = () => {};
export function setRouteHandler(fn) { routeHandler = fn; }

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function navigate(hash, { replace = false } = {}) {
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) { location.hash = hash; return; }
  routeHandler();
}

/** Update the query string without re-rendering (for remembering tabs/filters). */
export function setQuery(patch) {
  const { path, query } = parseHash();
  const q = new URLSearchParams({ ...query, ...patch });
  for (const [k, v] of [...q]) if (v === '' || v === 'undefined' || v === 'null') q.delete(k);
  const s = q.toString();
  history.replaceState(null, '', `#${path}${s ? `?${s}` : ''}`);
}

