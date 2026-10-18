import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeeklyIcs } from '../../js/ics.js';

test('weekly ics has rrule, first occurrence and CRLF line endings', () => {
  const now = new Date(2026, 9, 14, 18, 0).getTime(); // Wednesday 18:00
  const ics = buildWeeklyIcs({ days: [1, 3, 5], time: '17:30', title: 'Gym, legs; core', now });
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR/);
  // 17:30 Wednesday has passed, so the first event is Friday 16 Oct.
  assert.match(ics, /DTSTART:20261016T173000/);
  assert.match(ics, /DTEND:20261016T183000/);
  assert.match(ics, /SUMMARY:Gym\\, legs\\; core/);
  assert.ok(ics.includes('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'all line breaks are CRLF');
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
});

test('ics today counts when the time is still ahead', () => {
  const now = new Date(2026, 9, 14, 9, 0).getTime();
  assert.match(buildWeeklyIcs({ days: [3], time: '07:05', now }), /DTSTART:20261021T070500/);
  assert.match(buildWeeklyIcs({ days: [3], time: '10:00', now }), /DTSTART:20261014T100000/);
});

test('ics input validation', () => {
  assert.throws(() => buildWeeklyIcs({ days: [], time: '10:00' }), /weekday/);
  assert.throws(() => buildWeeklyIcs({ days: [1], time: '25:00' }), /valid time/);
});
