// Logique de calendrier pure (aucun accès au DOM) : partagée par l'application et les tests.

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Passe par le constructeur plutôt que par des millisecondes : reste juste lors des changements d'heure.
export function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function monthOf(date) {
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function shiftMonth({ year, month }, delta) {
  return monthOf(new Date(year, month + delta, 1));
}

export function sameMonth(a, b) {
  return a.year === b.year && a.month === b.month;
}

// Grille lundi → dimanche couvrant tout le mois, jours débordants des mois voisins compris.
export function buildMonthGrid(year, month, now) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((offset + daysInMonth) / 7);
  const start = addDays(first, -offset);
  const today = startOfDay(now);
  const todayKey = dateKey(today);

  const days = Array.from({ length: weeks * 7 }, (_, i) => {
    const date = addDays(start, i);
    const key = dateKey(date);
    return { date, key, inMonth: date.getMonth() === month, isToday: key === todayKey, isPast: date < today };
  });

  return { year, month, weeks, start, end: addDays(start, weeks * 7), days };
}

// Règles de couleur : aujourd'hui, puis passé, puis futur avec événement, sinon neutre.
export function dayState(day, events) {
  if (day.isToday) return 'today';
  if (day.isPast) return 'past';
  return events.length > 0 ? 'event' : 'empty';
}

// Dans une journée : journées entières d'abord, puis par heure de début.
export function compareEvents(a, b) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return a.start - b.start || a.title.localeCompare(b.title, 'fr');
}

// Range chaque événement sur chacun des jours qu'il touche (fin exclusive).
export function groupEventsByDay(events) {
  const byDay = new Map();
  for (const event of events) {
    const last = event.end > event.start ? new Date(event.end.getTime() - 1) : event.start;
    for (let day = startOfDay(event.start); day <= last; day = addDays(day, 1)) {
      const key = dateKey(day);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(event);
    }
  }
  for (const list of byDay.values()) list.sort(compareEvents);
  return byDay;
}
