// Événements fictifs calés sur la date du jour, pour essayer l'interface sans compte Google (?demo).

import { addDays, startOfDay } from './calendar.js';

export function demoEvents(now) {
  const today = startOfDay(now);
  let id = 0;

  const timed = (offset, hour, minute, minutes, title) => {
    const start = addDays(today, offset);
    start.setHours(hour, minute);
    return { id: `demo-${++id}`, title, allDay: false, start, end: new Date(start.getTime() + minutes * 60_000) };
  };
  const allDay = (offset, days, title) => ({
    id: `demo-${++id}`,
    title,
    allDay: true,
    start: addDays(today, offset),
    end: addDays(today, offset + days),
  });

  const mondayOffset = -((today.getDay() + 6) % 7);
  const weekly = Array.from({ length: 13 }, (_, i) => timed(mondayOffset + (i - 6) * 7, 9, 30, 30, 'Point équipe'));

  return [
    ...weekly,
    timed(-20, 14, 0, 120, 'Formation sécurité'),
    timed(-14, 11, 0, 60, 'Réunion client'),
    timed(-13, 12, 30, 90, "Déjeuner d'équipe"),
    allDay(-8, 2, 'Salon professionnel'),
    timed(-2, 15, 0, 60, 'Revue budget'),
    timed(0, 14, 0, 60, 'Appel fournisseur'),
    timed(0, 16, 30, 30, 'Point RH'),
    timed(1, 10, 0, 60, 'Revue de projet'),
    timed(6, 11, 0, 60, 'Réunion client'),
    timed(6, 16, 0, 60, 'Point fournisseurs'),
    timed(9, 13, 0, 60, 'Visite du site'),
    timed(13, 10, 0, 90, 'Comité de pilotage'),
  ];
}
