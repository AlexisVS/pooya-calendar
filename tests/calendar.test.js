import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMonthGrid, dateKey, dayState, groupEventsByDay, shiftMonth } from '../js/calendar.js';
import { isVisible, normalizeEvent } from '../js/google-calendar.js';

const NOW = new Date(2026, 9, 28, 13, 42); // mercredi 28 octobre 2026

const timed = (title, start, end) => ({ id: title, title, allDay: false, start, end });
const allDay = (title, start, end) => ({ id: title, title, allDay: true, start, end });

describe('buildMonthGrid', () => {
  it('commence un lundi et couvre octobre 2026 en 5 semaines', () => {
    const grid = buildMonthGrid(2026, 9, NOW);
    assert.equal(grid.weeks, 5);
    assert.equal(grid.days.length, 35);
    assert.equal(grid.days[0].key, '2026-09-28');
    assert.equal(grid.days.at(-1).key, '2026-11-01');
    assert.equal(dateKey(grid.end), '2026-11-02');
  });

  it('passe à 6 semaines quand le mois déborde (août 2026)', () => {
    const grid = buildMonthGrid(2026, 7, NOW);
    assert.equal(grid.weeks, 6);
    assert.equal(grid.days[0].key, '2026-07-27');
  });

  it('se contente de 4 semaines pour un février qui commence un lundi (2027)', () => {
    assert.equal(buildMonthGrid(2027, 1, NOW).weeks, 4);
  });

  it('marque aujourd’hui, le passé et les jours hors du mois', () => {
    const days = Object.fromEntries(buildMonthGrid(2026, 9, NOW).days.map((d) => [d.key, d]));
    assert.equal(days['2026-10-28'].isToday, true);
    assert.equal(days['2026-10-28'].isPast, false);
    assert.equal(days['2026-10-27'].isPast, true);
    assert.equal(days['2026-10-29'].isPast, false);
    assert.equal(days['2026-09-30'].inMonth, false);
    assert.equal(days['2026-11-01'].inMonth, false);
  });

  it('suit le jour courant : le lendemain devient « aujourd’hui » à minuit', () => {
    const todays = (now) => buildMonthGrid(2026, 9, now).days.filter((d) => d.isToday).map((d) => d.key);
    assert.deepEqual(todays(new Date(2026, 9, 28, 23, 59)), ['2026-10-28']);
    assert.deepEqual(todays(new Date(2026, 9, 29, 0, 0)), ['2026-10-29']);
  });
});

describe('dayState', () => {
  const day = (overrides) => ({ isToday: false, isPast: false, ...overrides });

  it('aujourd’hui reste « today », avec ou sans événement', () => {
    assert.equal(dayState(day({ isToday: true }), [{}]), 'today');
    assert.equal(dayState(day({ isToday: true }), []), 'today');
  });

  it('un jour passé reste « past », avec ou sans événement', () => {
    assert.equal(dayState(day({ isPast: true }), [{}]), 'past');
    assert.equal(dayState(day({ isPast: true }), []), 'past');
  });

  it('un jour futur est « event » avec un événement, « free » sinon', () => {
    assert.equal(dayState(day({}), [{}]), 'event');
    assert.equal(dayState(day({}), []), 'free');
  });
});

describe('groupEventsByDay', () => {
  it('étale une journée entière de plusieurs jours, fin exclusive', () => {
    const byDay = groupEventsByDay([allDay('Salon', new Date(2026, 9, 20), new Date(2026, 9, 22))]);
    assert.deepEqual([...byDay.keys()], ['2026-10-20', '2026-10-21']);
  });

  it('place un événement qui passe minuit sur les deux jours', () => {
    const byDay = groupEventsByDay([timed('Garde', new Date(2026, 9, 28, 23), new Date(2026, 9, 29, 1))]);
    assert.deepEqual([...byDay.keys()], ['2026-10-28', '2026-10-29']);
  });

  it('ne déborde pas sur le lendemain quand la fin tombe pile à minuit', () => {
    const byDay = groupEventsByDay([timed('Soirée', new Date(2026, 9, 28, 20), new Date(2026, 9, 29, 0))]);
    assert.deepEqual([...byDay.keys()], ['2026-10-28']);
  });

  it('trie : journées entières d’abord, puis par heure', () => {
    const list = groupEventsByDay([
      timed('Après-midi', new Date(2026, 9, 28, 14), new Date(2026, 9, 28, 15)),
      timed('Matin', new Date(2026, 9, 28, 9), new Date(2026, 9, 28, 10)),
      allDay('Congé', new Date(2026, 9, 28), new Date(2026, 9, 29)),
    ]).get('2026-10-28');
    assert.deepEqual(list.map((e) => e.title), ['Congé', 'Matin', 'Après-midi']);
  });
});

describe('shiftMonth', () => {
  it('change d’année au besoin', () => {
    assert.deepEqual(shiftMonth({ year: 2026, month: 11 }, 1), { year: 2027, month: 0 });
    assert.deepEqual(shiftMonth({ year: 2026, month: 0 }, -1), { year: 2025, month: 11 });
  });
});

describe('normalizeEvent (API Google)', () => {
  it('lit une journée entière en date locale', () => {
    const event = normalizeEvent({ id: '1', summary: 'Congé', start: { date: '2026-10-30' }, end: { date: '2026-10-31' } });
    assert.equal(event.allDay, true);
    assert.equal(dateKey(event.start), '2026-10-30');
    assert.equal(dateKey(event.end), '2026-10-31');
  });

  it('lit un événement horaire et nomme ceux sans titre', () => {
    const start = new Date(2026, 9, 29, 10);
    const end = new Date(2026, 9, 29, 11);
    const event = normalizeEvent({ id: '2', start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } });
    assert.equal(event.allDay, false);
    assert.equal(event.title, '(Sans titre)');
    assert.equal(event.start.getTime(), start.getTime());
  });

  it('masque les événements annulés et ceux refusés par la personne', () => {
    const base = { start: { date: '2026-10-30' }, end: { date: '2026-10-31' } };
    assert.equal(isVisible({ ...base, status: 'confirmed' }), true);
    assert.equal(isVisible({ ...base, status: 'cancelled' }), false);
    assert.equal(isVisible({ ...base, attendees: [{ self: true, responseStatus: 'declined' }] }), false);
    assert.equal(isVisible({ ...base, attendees: [{ self: true, responseStatus: 'accepted' }] }), true);
  });
});
