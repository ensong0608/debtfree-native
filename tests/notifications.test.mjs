import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObligationNotificationPayloads as build } from '../src/notifications.ts';
const now = new Date(2026, 0, 10, 10);
const prefs = { upcomingReminders: true, overdueAlerts: true };
const row = (id, dueDate, status = 'unpaid') => ({ id, name: id, dueDate, state: { status } });
test('schedules upcoming obligations at 9 AM, within 30 days', () => {
  const result = build([row('bill', '2026-01-12'), row('later', '2026-03-01')], { ...prefs, overdueAlerts: false }, now);
  assert.equal(result.length, 1); assert.equal(result[0].date.getDate(), 11); assert.equal(result[0].date.getHours(), 9);
});
test('schedules overdue at the next 9 AM', () => {
  const result = build([row('bill', '2026-01-09')], prefs, now);
  assert.equal(result.length, 1); assert.equal(result[0].date.getDate(), 11); assert.equal(result[0].date.getHours(), 9);
});
test('disabled preferences, paid and pending items are skipped', () => {
  assert.equal(build([row('a', '2026-01-12'), row('b', '2026-01-09')], { upcomingReminders: false, overdueAlerts: false }, now).length, 0);
  assert.equal(build([row('a', '2026-01-12', 'paid'), row('b', '2026-01-09', 'pending_confirmation')], prefs, now).length, 0);
});
test('caps notifications below the iOS limit', () => {
  assert.equal(build(Array.from({ length: 80 }, (_, i) => row(String(i), '2026-01-12')), prefs, now).length, 40);
});

test('schedules a future overdue alert without requiring another app launch', () => {
  const result = build([row('bill', '2026-01-12')], { upcomingReminders: false, overdueAlerts: true }, now);
  assert.equal(result.length, 1); assert.equal(result[0].date.getDate(), 13);
});
