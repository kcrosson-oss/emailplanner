// Date helpers. All workflow dates are plain "YYYY-MM-DD" strings (no timezone),
// and all deadline times are wall-clock "HH:mm" in US Eastern time — so nothing
// shifts when someone opens the app from another timezone.

export const TEAM_TZ = 'America/New_York';

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse "YYYY-MM-DD" into a UTC-midnight Date (safe for day arithmetic). */
export function parseDate(d: string): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

export function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(d: string, n: number): string {
  const dt = parseDate(d);
  dt.setUTCDate(dt.getUTCDate() + n);
  return formatDate(dt);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(d: string): number {
  return parseDate(d).getUTCDay();
}

export function isWeekend(d: string): boolean {
  const w = dayOfWeek(d);
  return w === 0 || w === 6;
}

/** Current wall-clock time in Eastern as { date: 'YYYY-MM-DD', time: 'HH:mm' }. */
export function nowInTZ(now: Date = new Date(), tz: string = TEAM_TZ): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon, Nov 2" */
export function prettyDate(d: string, withYear = false): string {
  const dt = parseDate(d);
  return `${DOW[dt.getUTCDay()]}, ${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}${withYear ? `, ${dt.getUTCFullYear()}` : ''}`;
}

/** "Nov 2" */
export function shortDate(d: string): string {
  const dt = parseDate(d);
  return `${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
}

export function monthLabel(d: string): string {
  const dt = parseDate(d);
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

/** "13:30" → "1:30 PM" */
export function prettyTime(t?: string | null): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${ap}`;
}

export const DOW_SHORT = DOW;
