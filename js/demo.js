// Fake events anchored on today's date, to try the interface without a Google account (?demo).
// Titles are shown on screen, so they are in Persian.

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
  const weekly = Array.from({ length: 13 }, (_, i) => timed(mondayOffset + (i - 6) * 7, 9, 30, 30, 'جلسهٔ تیم'));

  return [
    ...weekly,
    timed(-20, 14, 0, 120, 'آموزش ایمنی'),
    timed(-14, 11, 0, 60, 'جلسه با مشتری'),
    timed(-13, 12, 30, 90, 'ناهار تیمی'),
    allDay(-8, 2, 'نمایشگاه تخصصی'),
    timed(-2, 15, 0, 60, 'بررسی بودجه'),
    timed(0, 14, 0, 60, 'تماس با تأمین‌کننده'),
    timed(0, 16, 30, 30, 'جلسهٔ منابع انسانی'),
    timed(1, 10, 0, 60, 'بررسی پروژه'),
    timed(6, 11, 0, 60, 'جلسه با مشتری'),
    timed(6, 16, 0, 60, 'جلسه با تأمین‌کنندگان'),
    timed(9, 13, 0, 60, 'بازدید از سایت'),
    timed(13, 10, 0, 90, 'کمیتهٔ راهبری'),
  ];
}
