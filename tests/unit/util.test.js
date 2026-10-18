import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, parseDuration, fmtDuration, startOfWeek, isoWeek, parseLocalDate, isoDate, moveItem, fmtNum } from '../../js/util.js';

test('num accepts comma decimals and rejects junk', () => {
  assert.equal(num('42,5'), 42.5);
  assert.equal(num(' 40 '), 40);
  assert.equal(num(''), null);
  assert.equal(num('abc'), null);
  assert.equal(num(null), null);
  assert.equal(num(Infinity), null);
});

test('parseDuration handles mm:ss, h:mm:ss and minutes', () => {
  assert.equal(parseDuration('5:30'), 330);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration('45'), 2700);
  assert.equal(parseDuration('12,5'), 750);
  assert.equal(parseDuration('5:75'), null);
  assert.equal(parseDuration('a:b'), null);
  assert.equal(parseDuration(''), null);
});

test('fmtDuration', () => {
  assert.equal(fmtDuration(125), '2:05');
  assert.equal(fmtDuration(3725), '1:02:05');
  assert.equal(fmtDuration(-4), '0:00');
});

test('fmtNum strips trailing zeros', () => {
  assert.equal(fmtNum(42.5), '42.5');
  assert.equal(fmtNum(40), '40');
  assert.equal(fmtNum(null), '');
});

test('startOfWeek uses Monday by default', () => {
  const wed = new Date(2026, 9, 14, 15, 30).getTime(); // Wed 14 Oct 2026
  const s = new Date(startOfWeek(wed));
  assert.equal(s.getDay(), 1);
  assert.equal(s.getDate(), 12);
  assert.equal(s.getHours(), 0);
  const sunStart = new Date(startOfWeek(wed, 0));
  assert.equal(sunStart.getDay(), 0);
  assert.equal(sunStart.getDate(), 11);
});

test('isoWeek', () => {
  assert.equal(isoWeek(new Date(2026, 0, 1).getTime()), 1);
  assert.equal(isoWeek(new Date(2026, 9, 18).getTime()), 42);
});

test('local date round trip', () => {
  const ts = parseLocalDate('2026-03-05T07:45');
  assert.equal(isoDate(ts), '2026-03-05');
  assert.equal(new Date(ts).getHours(), 7);
  assert.equal(parseLocalDate('nope'), null);
});

test('moveItem', () => {
  const a = [1, 2, 3];
  assert.equal(moveItem(a, 0, 1), true);
  assert.deepEqual(a, [2, 1, 3]);
  assert.equal(moveItem(a, 0, -1), false);
});
