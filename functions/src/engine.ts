/**
 * Pure proposal + learning engine. No Firebase imports, so it is unit-testable.
 * Rule numbers refer to the PRD "Engine Rules" section.
 */
import { DAY_MS, istMidnightMs } from './lib/time';

export type Category = 'leafy' | 'vegetable' | 'root' | 'fruit' | 'herb' | 'dairy';
export type Unit = 'kg' | 'g' | 'pc' | 'bunch' | 'dozen';
export type Rotation = 'weekly' | 'biweekly' | 'monthly' | 'on_demand';
export type Reason = 'rotation' | 'finished' | 'season' | 'shortage_carry' | 'member_added' | 'manual';

export const CATEGORY_ORDER: Category[] = ['leafy', 'vegetable', 'root', 'herb', 'fruit', 'dairy'];
const ROTATION_LADDER: Rotation[] = ['weekly', 'biweekly', 'monthly', 'on_demand'];

export interface EngineItem {
  id: string;
  category: Category;
  defaultUnit: Unit;
  defaultQty: number;
  shelfLifeDays: number;
  /** Shortened by spoilage (onStockEvent). Falls back to shelfLifeDays. */
  effectiveShelfLifeDays?: number;
  seasonMonths: number[];
  peakMonths?: number[];
  rotation: Rotation;
  isPinned: boolean;
  isHidden: boolean;
  vendorId: string | null;
  lastReceivedAt: number | null;
  lastFinishedAt: number | null;
  halfLeftAt: number | null;
  medianKeptQty: number | null;
}

export interface EngineInput {
  /** Delivery date being proposed, 'YYYY-MM-DD' (IST). */
  forDate: string;
  /** The vendor's next delivery date after forDate (for the half_left rule), or null. */
  nextDeliveryDate: string | null;
  vendorId: string;
  vendorCategories: Category[];
  items: EngineItem[];
  /** Rule 1: last delivery's not_seen / short items. */
  carry: { itemId: string; qty: number; unit: Unit }[];
  /** Rule 2: spouse's add-to-next-order queue. */
  queue: { itemId: string; qty: number; unit: Unit; addedByUid: string }[];
  /** sentAt (or generatedAt) of the vendor's previous order — "since last order". */
  lastOrderAt: number | null;
  /** itemIds that appeared on any order in the last 21 days (for rule 6 season adds). */
  recentlyOrderedIds: string[];
  /** Festivals within the delivery week (rule 8 — banner only in V1). */
  festivals: { name: string; date: string }[];
}

export interface ProposedLine {
  itemId: string;
  qty: number;
  unit: Unit;
  reason: Reason;
  addedByUid: string | null;
}

export interface SkippedEntry {
  itemId: string;
  reason: 'still_at_home' | 'out_of_season';
  receivedDaysAgo?: number;
}

export interface EngineOutput {
  lines: ProposedLine[];
  skipped: SkippedEntry[];
  peakItemIds: string[];
  festivalBanner: string | null;
}

const roundQty = (q: number, unit: Unit): number => {
  if (unit === 'g') return Math.max(50, Math.round(q / 50) * 50);
  if (unit === 'kg') return Math.max(0.25, Math.round(q * 4) / 4);
  return Math.max(1, Math.round(q));
};

export const shelfLife = (it: EngineItem) => Math.max(1, it.effectiveShelfLifeDays ?? it.shelfLifeDays);

export const inSeason = (it: EngineItem, month: number) =>
  it.seasonMonths.length === 0 || it.seasonMonths.includes(month);

const servesVendor = (it: EngineItem, vendorId: string, cats: Category[]) =>
  (it.vendorId === null || it.vendorId === vendorId) && (cats.length === 0 || cats.includes(it.category));

/** Rule 8 base quantity. */
export const baseQty = (it: EngineItem) => it.medianKeptQty ?? it.defaultQty;

export function proposeOrder(input: EngineInput): EngineOutput {
  const deliveryMs = istMidnightMs(input.forDate);
  const month = Number(input.forDate.slice(5, 7));
  const byId = new Map(input.items.map((i) => [i.id, i]));
  const lines = new Map<string, ProposedLine>();
  const skipped: SkippedEntry[] = [];

  const add = (itemId: string, qty: number, unit: Unit, reason: Reason, addedByUid: string | null = null) => {
    if (lines.has(itemId)) return; // first (highest-priority) rule wins
    lines.set(itemId, { itemId, qty: roundQty(qty, unit), unit, reason, addedByUid });
  };

  // Rule 1 — carry-overs
  for (const c of input.carry) if (byId.has(c.itemId)) add(c.itemId, c.qty, c.unit, 'shortage_carry');

  // Rule 2 — member queue
  for (const q of input.queue) if (byId.has(q.itemId)) add(q.itemId, q.qty, q.unit, 'member_added', q.addedByUid);

  const candidates = input.items.filter(
    (it) => !it.isHidden && !lines.has(it.id) && servesVendor(it, input.vendorId, input.vendorCategories),
  );

  for (const it of candidates) {
    // Rule 6 (exclusion half) — out of season unless pinned
    if (!inSeason(it, month) && !it.isPinned) continue;

    const since = input.lastOrderAt ?? it.lastReceivedAt ?? 0;
    const finishedSinceLastOrder =
      it.lastFinishedAt !== null && it.lastFinishedAt > since && it.lastFinishedAt >= (it.lastReceivedAt ?? 0);

    // Rule 3 — finished
    if (finishedSinceLastOrder) {
      add(it.id, baseQty(it), it.defaultUnit, 'finished');
      continue;
    }
    // Rule 3 — half left, will expire before the following delivery
    if (it.halfLeftAt !== null && it.halfLeftAt >= (it.lastReceivedAt ?? 0) && it.lastReceivedAt !== null) {
      const expiresAt = it.lastReceivedAt + shelfLife(it) * DAY_MS;
      const horizon = input.nextDeliveryDate ? istMidnightMs(input.nextDeliveryDate) : deliveryMs + 7 * DAY_MS;
      if (expiresAt < horizon) {
        add(it.id, it.defaultQty * 0.5, it.defaultUnit, 'finished');
        continue;
      }
    }

    // Rule 4 — rotation due
    const daysSince = it.lastReceivedAt === null ? Infinity : (deliveryMs - it.lastReceivedAt) / DAY_MS;
    const due =
      it.rotation === 'weekly' ||
      (it.rotation === 'biweekly' && daysSince >= 12) ||
      (it.rotation === 'monthly' && daysSince >= 26);
    if (!due) continue;

    // Rule 5 — shelf-life suppression (no finished event since receipt)
    if (daysSince < shelfLife(it) * 0.8) {
      skipped.push({ itemId: it.id, reason: 'still_at_home', receivedDaysAgo: Math.floor(daysSince) });
      continue;
    }
    add(it.id, baseQty(it), it.defaultUnit, 'rotation');
  }

  // Rule 6 (addition half) — up to 3 in-season items not ordered in 21 days, peak first
  const recent = new Set(input.recentlyOrderedIds);
  const seasonal = candidates
    .filter(
      (it) =>
        !lines.has(it.id) &&
        it.seasonMonths.length > 0 &&
        it.seasonMonths.includes(month) &&
        !recent.has(it.id) &&
        !skipped.some((s) => s.itemId === it.id),
    )
    .sort((a, b) => {
      const pa = a.peakMonths?.includes(month) ? 0 : 1;
      const pb = b.peakMonths?.includes(month) ? 0 : 1;
      return pa - pb || a.id.localeCompare(b.id);
    })
    .slice(0, 3);
  for (const it of seasonal) add(it.id, baseQty(it), it.defaultUnit, 'season');

  // Rule 9 — sort by category order (stable by insertion within a category)
  const order = (id: string) => CATEGORY_ORDER.indexOf(byId.get(id)!.category);
  const sorted = [...lines.values()].sort((a, b) => order(a.itemId) - order(b.itemId));

  const peakItemIds = sorted.filter((l) => byId.get(l.itemId)!.peakMonths?.includes(month)).map((l) => l.itemId);
  const festivalBanner = input.festivals.length ? input.festivals.map((f) => f.name).join(', ') : null;

  return { lines: sorted, skipped, peakItemIds, festivalBanner };
}

/* ---------------- Rule 7 — skip learning (runs on approve) ---------------- */

export interface LearningState {
  rotation: Rotation;
  skipStreak: number;
  addStreak: number;
  /** epoch ms of recent manual adds (kept ≤ 6 weeks) */
  addHistory: number[];
}

export type DraftOutcome = 'kept' | 'removed' | 'added' | 'not_in_draft';

export interface LearningResult extends LearningState {
  notice: string | null;
}

const SIX_WEEKS = 42 * DAY_MS;

export function applyLearning(s: LearningState, outcome: DraftOutcome, now: number): LearningResult {
  let { rotation, skipStreak } = s;
  let addHistory = s.addHistory.filter((t) => now - t <= SIX_WEEKS);
  let notice: string | null = null;

  if (outcome === 'removed') {
    skipStreak += 1;
    if (skipStreak >= 3) {
      const idx = ROTATION_LADDER.indexOf(rotation);
      if (idx < ROTATION_LADDER.length - 1) {
        const next = ROTATION_LADDER[idx + 1];
        notice = `demoted:${rotation}->${next}`;
        rotation = next;
      }
      skipStreak = 0;
    }
  } else if (outcome === 'kept') {
    skipStreak = 0;
  } else if (outcome === 'added') {
    skipStreak = 0;
    addHistory = [...addHistory, now];
    if (rotation === 'on_demand' && addHistory.length >= 3) {
      rotation = 'biweekly';
      notice = 'promoted:on_demand->biweekly';
      addHistory = [];
    }
  }
  return { rotation, skipStreak, addStreak: addHistory.length, addHistory, notice };
}

/** Median of kept quantities — maintained on confirmDelivery. */
export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Recognition thresholds on `confidence` = probability the item IS in the photo:
 * ≥0.7 received, ≤0.3 not_seen, else unsure.
 */
export function statusFromConfidence(confidence: number): 'received' | 'not_seen' | 'unsure' {
  if (confidence >= 0.7) return 'received';
  if (confidence <= 0.3) return 'not_seen';
  return 'unsure';
}
