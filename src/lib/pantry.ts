import type { Item, StockEvent, StockState } from './types';
import { DAY_MS } from './dates';

export interface Belief {
  item: Item;
  state: StockState;
  atHome: boolean;
  /** expected run-out (epoch ms) */
  runOutMs: number | null;
  receivedMs: number | null;
}

const ms = (t: { toMillis(): number } | null | undefined) => (t ? t.toMillis() : null);

/**
 * Pantry belief = item fields maintained by Functions, overridden by any newer local stock event
 * (including pending offline writes), so taps show instantly even without network.
 */
export function computeBeliefs(items: Item[], events: StockEvent[], now = Date.now()): Belief[] {
  const latestEvent = new Map<string, StockEvent>();
  for (const e of events) {
    const prev = latestEvent.get(e.itemId);
    if (!prev || ms(e.at)! > ms(prev.at)!) latestEvent.set(e.itemId, e);
  }

  return items
    .filter((it) => !it.isHidden)
    .map((item) => {
      let r = ms(item.lastReceivedAt);
      const f = ms(item.lastFinishedAt);
      let h = ms(item.halfLeftAt ?? null);
      let state: StockState =
        item.stockState && item.stockState !== 'unknown'
          ? item.stockState
          : f && (!r || f >= r) ? 'finished' : h && r && h >= r ? 'half' : r ? 'full' : 'unknown';

      const e = latestEvent.get(item.id);
      const eAt = e ? ms(e.at)! : 0;
      if (e && eAt > Math.max(r ?? 0, f ?? 0, h ?? 0)) {
        if (e.kind === 'finished') state = 'finished';
        else if (e.kind === 'spoiled') state = 'spoiled';
        else if (e.kind === 'half_left') { state = 'half'; h = eAt; }
        else if (e.kind === 'received') { state = 'full'; r = eAt; h = null; }
        else if (e.kind === 'manual_set') {
          if (e.qty <= 0) state = 'finished';
          else if (e.qty < 1) { state = 'half'; h = eAt; }
          else { state = 'full'; r = eAt; h = null; }
        }
      }

      const shelf = Math.max(1, item.effectiveShelfLifeDays ?? item.shelfLifeDays) * DAY_MS;
      let runOutMs: number | null = null;
      if (r && (state === 'full' || state === 'half')) {
        runOutMs = r + shelf;
        if (state === 'half' && h) runOutMs = Math.min(runOutMs, h + Math.max(DAY_MS, (r + shelf - h) / 2));
      }
      const atHome = (state === 'full' || state === 'half') && r !== null && now - r < shelf * 2;
      return { item, state, atHome, runOutMs, receivedMs: r };
    });
}
