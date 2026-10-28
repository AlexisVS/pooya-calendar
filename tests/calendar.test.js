import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMonthGrid, dateKey, dayState, groupEventsByDay, shiftMonth } from '../js/calendar.js';
import { isVisible, normalizeEvent } from '../js/google-calendar.js';

const NOW = new Date(2026, 9, 28, 13, 42); // Wednesday 28 October 2026

const timed = (title, start, end) => ({ id: title, title, allDay: false, start, end });
const allDay = (title, start, end) => ({ id: title, title, allDay: true, start, end });

describe('buildMonthGrid', () => {
  it('starts on a Monday and covers October 2026 in 5 weeks', () => {
    const grid = buildMonthGrid(2026, 9, NOW);
    assert.equal(grid.weeks, 5);
    assert.equal(grid.days.length, 35);
    assert.equal(grid.days[0].key, '2026-09-28');
    assert.equal(grid.days.at(-1).key, '2026-11-01');
    assert.equal(dateKey(grid.end), '2026-11-02');
  });

  it('uses 6 weeks when the month overflows (August 2026)', () => {
    const grid = buildMonthGrid(2026, 7, NOW);
    assert.equal(grid.weeks, 6);
    assert.equal(grid.days[0].key, '2026-07-27');
  });

  it('needs only 4 weeks for a February starting on a Monday (2027)', () => {
    assert.equal(buildMonthGrid(2027, 1, NOW).weeks, 4);
  });

  it('flags today, past days and days outside the month', () => {
    const days = Object.fromEntries(buildMonthGrid(2026, 9, NOW).days.map((d) => [d.key, d]));
    assert.equal(days['2026-10-28'].isToday, true);
    assert.equal(days['2026-10-28'].isPast, false);
    assert.equal(days['2026-10-27'].isPast, true);
    assert.equal(days['2026-10-29'].isPast, false);
    assert.equal(days['2026-09-30'].inMonth, false);
    assert.equal(days['2026-11-01'].inMonth, false);
  });

  it('follows the current day: tomorrow becomes "today" at midnight', () => {
    const todays = (now) => buildMonthGrid(2026, 9, now).days.filter((d) => d.isToday).map((d) => d.key);
    assert.deepEqual(todays(new Date(2026, 9, 28, 23, 59)), ['2026-10-28']);
    assert.deepEqual(todays(new Date(2026, 9, 29, 0, 0)), ['2026-10-29']);
  });
});

describe('dayState', () => {
  const day = (overrides) => ({ isToday: false, isPast: false, ...overrides });

  it('today stays "today", with or without events', () => {
    assert.equal(dayState(day({ isToday: true }), [{}]), 'today');
    assert.equal(dayState(day({ isToday: true }), []), 'today');
  });

  it('a past day stays "past", with or without events', () => {
    assert.equal(dayState(day({ isPast: true }), [{}]), 'past');
    assert.equal(dayState(day({ isPast: true }), []), 'past');
  });

  it('a future day is "event" with an event, "free" otherwise', () => {
    assert.equal(dayState(day({}), [{}]), 'event');
    assert.equal(dayState(day({}), []), 'free');
  });
});

describe('groupEventsByDay', () => {
  it('spreads a multi-day all-day event, end exclusive', () => {
    const byDay = groupEventsByDay([allDay('Trade fair', new Date(2026, 9, 20), new Date(2026, 9, 22))]);
    assert.deepEqual([...byDay.keys()], ['2026-10-20', '2026-10-21']);
  });

  it('places an event crossing midnight on both days', () => {
    const byDay = groupEventsByDay([timed('Night shift', new Date(2026, 9, 28, 23), new Date(2026, 9, 29, 1))]);
    assert.deepEqual([...byDay.keys()], ['2026-10-28', '2026-10-29']);
  });

  it('does not spill into the next day when the end is exactly midnight', () => {
    const byDay = groupEventsByDay([timed('Evening', new Date(2026, 9, 28, 20), new Date(2026, 9, 29, 0))]);
    assert.deepEqual([...byDay.keys()], ['2026-10-28']);
  });

  it('sorts all-day events first, then by time', () => {
    const list = groupEventsByDay([
      timed('Afternoon', new Date(2026, 9, 28, 14), new Date(2026, 9, 28, 15)),
      timed('Morning', new Date(2026, 9, 28, 9), new Date(2026, 9, 28, 10)),
      allDay('Day off', new Date(2026, 9, 28), new Date(2026, 9, 29)),
    ]).get('2026-10-28');
    assert.deepEqual(list.map((e) => e.title), ['Day off', 'Morning', 'Afternoon']);
  });
});

describe('shiftMonth', () => {
  it('changes year when needed', () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  });
});

describe('normalizeEvent (Google API)', () => {
  it('reads an all-day event as a local date', () => {
    const event = normalizeEvent({ id: '1', summary: 'Day off', start: { date: '2026-10-30' }, end: { date: '2026-10-31' } });
    assert.equal(event.allDay, true);
    assert.equal(dateKey(event.start), '2026-10-30');
    assert.equal(dateKey(event.end), '2026-10-31');
  });

  it('reads a timed event and names untitled ones in Persian', () => {
    const start = new Date(2026, 9, 29, 10);
    const end = new Date(2026, 9, 29, 11);
    const event = normalizeEvent({ id: '2', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } });
    assert.equal(event.allDay, false);
    assert.equal(event.title, '(بدون عنوان)');
    assert.equal(event.start.getTime(), start.getTime());
  });

  it('hides cancelled events and those the person declined', () => {
    const base = { start: { date: '2026-10-30' }, end: { date: '2026-10-31' } };
    assert.equal(isVisible({ ...base, status: 'confirmed' }), true);
    assert.equal(isVisible({ ...base, status: 'cancelled' }), false);
    assert.equal(isVisible({ ...base, attendees: [{ self: true, responseStatus: 'declined' }] }), false);
    assert.equal(isVisible({ ...base, attendees: [{ self: true, responseStatus: 'accepted' }] }), true);
  });
});
