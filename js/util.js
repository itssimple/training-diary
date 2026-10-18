// Small, dependency-free helpers shared by logic and UI modules.
// Everything here must be pure (no DOM access) so it can run under Node tests.

export function uid(prefix = 'id') {
  const c = globalThis.crypto;
  const raw = c && typeof c.randomUUID === 'function'
    ? c.randomUUID()
    : 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = (Math.random() * 16) | 0;
      return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  return `${prefix}_${raw.replace(/-/g, '').slice(0, 20)}`;
}

export const clone = (value) => structuredClone(value);

/** Parse a user-entered number. Accepts comma decimals ("42,5"). Returns null when empty/invalid. */
export function num(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const s = String(value).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function round(n, digits = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/** Format a number without trailing zeros: 42.50 -> "42.5", 40 -> "40". */
export function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return String(round(n, digits));
}

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 3725 -> "1:02:05", 125 -> "2:05". Negative values are clamped to 0. */
export function fmtDuration(totalSec) {
  if (totalSec === null || totalSec === undefined || !Number.isFinite(totalSec)) return '';
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${m}:${pad2(sec)}`;
}

/** Human-friendly: 3725 -> "1 h 2 min", 45 -> "45 s". */
export function fmtDurationWords(totalSec) {
  if (!Number.isFinite(totalSec)) return '';
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return m ? `${h} h ${m} min` : `${h} h`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

/**
 * Parse "mm:ss", "h:mm:ss" or a plain number of minutes ("45", "12,5").
 * Returns seconds or null.
 */
export function parseDuration(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (s === '') return null;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => p.trim());
    if (parts.length > 3 || parts.some((p) => p === '' || !/^\d+$/.test(p))) return null;
    const nums = parts.map(Number);
    if (nums.slice(1).some((n) => n >= 60)) return null;
    return nums.reduce((acc, n) => acc * 60 + n, 0);
  }
  const minutes = num(s);
  if (minutes === null || minutes < 0) return null;
  return Math.round(minutes * 60);
}

// ---------- dates (local time) ----------

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function addDays(ts, days) {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Start of the week containing ts. weekStart: 0 = Sunday, 1 = Monday. */
export function startOfWeek(ts, weekStart = 1) {
  const d = new Date(startOfDay(ts));
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function weekRange(ts, weekStart = 1) {
  const start = startOfWeek(ts, weekStart);
  return { start, end: addDays(start, 7) };
}

/** ISO-8601 week number (weeks start Monday). */
export function isoWeek(ts) {
  const d = new Date(startOfDay(ts));
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

/** "YYYY-MM-DD" in local time. */
export function isoDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** "YYYY-MM-DDTHH:mm" in local time, for <input type="datetime-local">. */
export function isoDateTimeLocal(ts) {
  const d = new Date(ts);
  return `${isoDate(ts)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Parse a local "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" string. Returns ms or null. */
export function parseLocalDate(str) {
  if (!str) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(String(str));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0));
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const LOCALE = 'en-GB';

export function fmtDate(ts, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleDateString(LOCALE, opts);
}

export function fmtDateShort(ts) {
  const now = Date.now();
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return fmtDate(ts, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });
}

export function fmtWeekday(ts) {
  return new Date(ts).toLocaleDateString(LOCALE, { weekday: 'short' });
}

/** "Today", "Yesterday", "3 days ago", or a date. */
export function fmtRelativeDay(ts, now = Date.now()) {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return fmtDateShort(ts);
}

export function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

export function byOrder(a, b) {
  return (a.order ?? 0) - (b.order ?? 0);
}

export function moveItem(arr, index, delta) {
  const to = index + delta;
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return false;
  const [item] = arr.splice(index, 1);
  arr.splice(to, 0, item);
  return true;
}
