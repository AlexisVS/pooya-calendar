// Reads events through the Google Calendar API v3 (called directly from the browser).
// Error messages are shown on screen, so they are in Dutch.

import { parseDateKey } from './calendar.js';

const API_BASE = 'https://www.googleapis.com/calendar/v3/calendars/';
const FIELDS = 'items(id,status,summary,start,end,attendees(self,responseStatus)),nextPageToken';

export class CalendarError extends Error {
  // code: not-found | api-disabled | scope | rate-limit | http
  constructor(code, message) {
    super(message);
    this.name = 'CalendarError';
    this.code = code;
  }
}

// All-day events (start.date) stay in local time, with no time zone shift.
export function normalizeEvent(item) {
  const allDay = Boolean(item.start.date);
  return {
    id: item.id,
    title: item.summary?.trim() || '(Geen titel)',
    allDay,
    start: allDay ? parseDateKey(item.start.date) : new Date(item.start.dateTime),
    end: allDay ? parseDateKey(item.end.date) : new Date(item.end.dateTime),
  };
}

export function isVisible(item) {
  if (item.status === 'cancelled' || !item.start) return false;
  const self = item.attendees?.find((attendee) => attendee.self);
  return self?.responseStatus !== 'declined';
}

export async function fetchEvents({ calendarId, timeMin, timeMax, auth }) {
  const items = [];
  let pageToken;
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      fields: FIELDS,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await getJson(`${API_BASE}${encodeURIComponent(calendarId)}/events?${params}`, auth);
    items.push(...(data.items ?? []));
    pageToken = data.nextPageToken;
  } while (pageToken);

  return items.filter(isVisible).map(normalizeEvent);
}

async function getJson(url, auth, retried = false) {
  const token = await auth.getAccessToken();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (response.status === 401 && !retried) {
    auth.invalidateAccessToken();
    return getJson(url, auth, true);
  }
  if (!response.ok) throw await toCalendarError(response);
  return response.json();
}

async function toCalendarError(response) {
  const body = await response.json().catch(() => ({}));
  const reasons = [body.error?.status, ...(body.error?.errors ?? []).map((e) => e.reason)];
  const has = (...names) => names.some((name) => reasons.includes(name));

  if (response.status === 404) {
    return new CalendarError('not-found', 'Agenda niet gevonden: controleer calendarId in config.js');
  }
  if (has('accessNotConfigured', 'SERVICE_DISABLED')) {
    return new CalendarError('api-disabled', 'De Google Calendar API is niet ingeschakeld in het Google Cloud-project');
  }
  if (has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return new CalendarError('scope', 'Er is geen toegang tot de afspraken gegeven');
  }
  if (response.status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'RESOURCE_EXHAUSTED')) {
    return new CalendarError('rate-limit', 'Google beperkt tijdelijk het aantal verzoeken; nieuwe poging bij de volgende ronde');
  }
  return new CalendarError('http', `Google Agenda antwoordde met fout ${response.status}`);
}
