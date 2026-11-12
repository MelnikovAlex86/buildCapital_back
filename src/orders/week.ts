export function projectKey(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
}

export function appTimeZone() {
  return process.env.APP_TIMEZONE?.trim() || 'Asia/Yekaterinburg';
}

export function formatStamp(date: Date, timeZone = appTimeZone()) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

const weekdayFromMonday: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

function calendarParts(date: Date, timeZone: string) {
  const bag: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    weekday: bag.weekday,
  };
}

function shiftDate(year: number, month: number, day: number, days: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function zoneOffset(date: Date, timeZone: string) {
  const bag: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)) {
    if (part.type !== 'literal') {
      bag[part.type] = part.value;
    }
  }
  const asUtc = Date.UTC(
    Number(bag.year),
    Number(bag.month) - 1,
    Number(bag.day),
    Number(bag.hour) % 24,
    Number(bag.minute),
    Number(bag.second),
  );
  return asUtc - date.getTime();
}

function startOfZonedDay(
  year: number,
  month: number,
  day: number,
  timeZone: string,
) {
  const utcGuess = Date.UTC(year, month - 1, day);
  const offset = zoneOffset(new Date(utcGuess), timeZone);
  const instant = new Date(utcGuess - offset);
  const checked = zoneOffset(instant, timeZone);
  return checked === offset ? instant : new Date(utcGuess - checked);
}

export function currentWeek(now = new Date(), timeZone = appTimeZone()) {
  const parts = calendarParts(now, timeZone);
  const monday = shiftDate(
    parts.year,
    parts.month,
    parts.day,
    -weekdayFromMonday[parts.weekday],
  );
  const next = shiftDate(monday.year, monday.month, monday.day, 7);
  return {
    start: startOfZonedDay(monday.year, monday.month, monday.day, timeZone),
    end: startOfZonedDay(next.year, next.month, next.day, timeZone),
  };
}

export function inCurrentWeek(
  date: Date,
  now = new Date(),
  timeZone = appTimeZone(),
) {
  const week = currentWeek(now, timeZone);
  return date >= week.start && date < week.end;
}
