/** IST-based date helpers for the client (households are in India). */
const IST_OFFSET_MS = 330 * 60 * 1000;
export const DAY_MS = 86_400_000;

export const todayStr = (d = new Date()) => new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);

export function addDaysStr(date: string, n: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

export const dowOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const istMs = (date: string, hhmm = '00:00') => Date.parse(`${date}T${hhmm}:00Z`) - IST_OFFSET_MS;

/** "HH:mm" in IST from epoch ms */
export function istTime(ms: number) {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(11, 16);
}

export function nextDeliveryDate(days: number[], from = todayStr()): string | null {
  for (let i = 1; i <= 7; i++) {
    const d = addDaysStr(from, i);
    if (days.includes(dowOf(d))) return d;
  }
  return null;
}

export const dayIndexFromMs = (ms: number) => new Date(ms + IST_OFFSET_MS).getUTCDay();
