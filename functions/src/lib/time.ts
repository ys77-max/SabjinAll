/** All household dates are evaluated in India Standard Time (UTC+5:30, no DST). */
export const TZ = 'Asia/Kolkata';
const IST_OFFSET_MS = 330 * 60 * 1000;
export const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' for the IST calendar day containing `d`. */
export function istDateString(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Add whole days to a 'YYYY-MM-DD' string. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a 'YYYY-MM-DD'. */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 1–12 */
export function monthOf(date: string): number {
  return Number(date.slice(5, 7));
}

/** Epoch ms of 'YYYY-MM-DD' + 'HH:mm' interpreted in IST. */
export function istDateTimeMs(date: string, hhmm: string): number {
  return Date.parse(`${date}T${hhmm}:00Z`) - IST_OFFSET_MS;
}

/** Epoch ms of IST midnight starting `date`. */
export function istMidnightMs(date: string): number {
  return istDateTimeMs(date, '00:00');
}

/** Current IST hour 0–23. */
export function istHour(d: Date): number {
  return new Date(d.getTime() + IST_OFFSET_MS).getUTCHours();
}

/** Next date strictly after `date` whose weekday is in `days`, or null. */
export function nextDeliveryAfter(date: string, days: number[]): string | null {
  if (!days.length) return null;
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, i);
    if (days.includes(dayOfWeek(d))) return d;
  }
  return null;
}
