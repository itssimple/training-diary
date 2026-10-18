// iCalendar (.ics) generation for recurring training reminders. Works fully offline:
// the file is created locally and opened/imported by the device's calendar app, which is
// what actually delivers the reminder (the web app cannot notify while closed).

import { pad2, uid } from './util.js';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function localStamp(d) {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
}

function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`;
}

/** Fold lines longer than 75 octets as required by RFC 5545 (approximation by characters). */
function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
}

/**
 * days: weekday numbers (0 = Sunday … 6 = Saturday), time: "HH:MM".
 * Returns the .ics text. Times are "floating" local times, so they follow the device time zone.
 */
export function buildWeeklyIcs({ days, time = '17:30', durationMin = 60, title = 'Training', description = '', alarmMinutes = 15, now = Date.now() }) {
  const sorted = [...new Set(days)].filter((d) => d >= 0 && d <= 6).sort();
  if (!sorted.length) throw new Error('Choose at least one weekday.');
  const m = /^(\d{1,2}):(\d{2})$/.exec(time || '');
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) throw new Error('Enter a valid time (HH:MM).');
  const start = new Date(now);
  start.setHours(Number(m[1]), Number(m[2]), 0, 0);
  // First occurrence: the next matching weekday from today (today counts if the time is still ahead).
  for (let i = 0; i < 8; i++) {
    if (sorted.includes(start.getDay()) && start.getTime() > now) break;
    start.setDate(start.getDate() + 1);
  }
  const end = new Date(start.getTime() + durationMin * 60000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Training Diary//Offline PWA//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid('rem')}@training-diary.local`,
    `DTSTAMP:${utcStamp(new Date(now))}`,
    `DTSTART:${localStamp(start)}`,
    `DTEND:${localStamp(end)}`,
    `RRULE:FREQ=WEEKLY;BYDAY=${sorted.map((d) => BYDAY[d]).join(',')}`,
    `SUMMARY:${escapeText(title)}`,
    description ? `DESCRIPTION:${escapeText(description)}` : null,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(title)}`,
    `TRIGGER:-PT${Math.max(0, Math.round(alarmMinutes))}M`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
