// Reads events through the Google Calendar API v3 (called directly from the browser).
// Error messages are shown on screen, so they are in Persian.

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
    title: item.summary?.trim() || '(بدون عنوان)',
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
    return new CalendarError('not-found', 'تقویم پیدا نشد: calendarId را در config.js بررسی کنید');
  }
  if (has('accessNotConfigured', 'SERVICE_DISABLED')) {
    return new CalendarError('api-disabled', 'Google Calendar API در پروژهٔ Google Cloud فعال نیست');
  }
  if (has('insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
    return new CalendarError('scope', 'اجازهٔ دسترسی به رویدادها داده نشده است');
  }
  if (response.status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'RESOURCE_EXHAUSTED')) {
    return new CalendarError('rate-limit', 'Google موقتاً درخواست‌ها را محدود کرده است؛ در نوبت بعد دوباره تلاش می‌شود');
  }
  return new CalendarError('http', `پاسخ Google Calendar: خطای ${response.status}`);
}
