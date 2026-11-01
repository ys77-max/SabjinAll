import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, hh, FieldValue, Timestamp, callableOpts, requireAuth, requireMember, str } from './lib/admin';
import { istDateTimeMs } from './lib/time';
import { median } from './engine';

type RS = 'received' | 'not_seen' | 'unsure' | 'short';
interface LineIn {
  itemId: string;
  receivedStatus: RS;
  receivedQty: number | null;
  price?: number | null;
}
interface ExtraIn {
  itemId: string;
  qty: number;
  unit: string;
}

const KEPT_HISTORY = 6;

/**
 * Confirm a delivery after the check screen. Writes `received` stockEvents, item lastReceivedAt,
 * medianKeptQty, order status + lateness + spend. not_seen / short lines are picked up as
 * carry-overs by the next proposal. `unsure` is treated as received (user confirmed the screen).
 */
export const confirmDelivery = onCall(callableOpts, async (req) => {
  const uid = requireAuth(req);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const hid = str(d.householdId, 'householdId');
  const oid = str(d.orderId, 'orderId');
  const linesIn = (Array.isArray(d.lines) ? d.lines : []) as LineIn[];
  const extrasIn = (Array.isArray(d.extras) ? d.extras : []) as ExtraIn[];
  await requireMember(hid, uid);

  const h = hh(hid);
  const orderRef = h.collection('orders').doc(oid);
  const order = await orderRef.get();
  if (!order.exists) throw new HttpsError('not-found', 'Order not found');
  if (['received', 'partially_received', 'cancelled'].includes(order.get('status'))) {
    throw new HttpsError('failed-precondition', 'Already confirmed');
  }
  const [vendor, lineSnap, photos] = await Promise.all([
    h.collection('vendors').doc(order.get('vendorId')).get(),
    orderRef.collection('items').get(),
    orderRef.collection('photos').limit(1).get(),
  ]);
  const source = photos.empty ? 'order' : 'photo';
  const lineById = new Map(lineSnap.docs.map((l) => [l.id, l]));
  const now = Timestamp.now();
  const batch = db.batch();

  const shortItemIds: string[] = [];
  let anyMissing = false;
  let spend = 0;
  let anyPrice = false;

  for (const li of linesIn) {
    const line = lineById.get(li.itemId);
    if (!line || line.get('status') === 'removed') continue;
    const rs: RS = ['received', 'not_seen', 'unsure', 'short'].includes(li.receivedStatus) ? li.receivedStatus : 'received';
    const ordered: number = line.get('qty');
    const unit: string = line.get('unit');
    const qty = rs === 'not_seen' ? 0 : Math.max(0, Number(li.receivedQty ?? ordered));
    const finalRs: RS = rs === 'unsure' ? 'received' : rs === 'received' && qty < ordered ? 'short' : rs;
    const price = typeof li.price === 'number' && li.price >= 0 ? li.price : null;
    if (price !== null) {
      spend += price;
      anyPrice = true;
    }

    batch.update(line.ref, { receivedStatus: finalRs, receivedQty: qty, price });
    if (finalRs === 'not_seen' || finalRs === 'short') {
      anyMissing = true;
      shortItemIds.push(li.itemId);
    }
    if (qty > 0) {
      batch.create(h.collection('stockEvents').doc(), {
        itemId: li.itemId, kind: 'received', qty, unit, source, at: now, byUid: uid,
      });
      const itemRef = h.collection('items').doc(li.itemId);
      const item = await itemRef.get();
      const kept: number[] = [...((item.get('keptQtyHistory') as number[]) ?? []), qty].slice(-KEPT_HISTORY);
      batch.update(itemRef, {
        lastReceivedAt: now,
        halfLeftAt: null,
        stockState: 'full',
        keptQtyHistory: kept,
        medianKeptQty: kept.length >= 3 ? median(kept) : null,
      });
    }
  }

  // "Also received?" extras the user ticked
  for (const ex of extrasIn) {
    if (!ex?.itemId || !(ex.qty > 0)) continue;
    batch.create(h.collection('stockEvents').doc(), {
      itemId: ex.itemId, kind: 'received', qty: ex.qty, unit: ex.unit, source, at: now, byUid: uid,
    });
    batch.update(h.collection('items').doc(ex.itemId), { lastReceivedAt: now, halfLeftAt: null, stockState: 'full' });
  }

  const due = istDateTimeMs(order.get('forDate'), vendor.get('usualDeliveryTime') ?? '10:00');
  const latenessMin = Math.max(0, Math.round((now.toMillis() - due) / 60_000));
  batch.update(orderRef, {
    status: anyMissing ? 'partially_received' : 'received',
    receivedAt: FieldValue.serverTimestamp(),
    latenessMin,
    totalSpend: anyPrice ? spend : null,
  });
  await batch.commit();
  return { status: anyMissing ? 'partially_received' : 'received', shortItemIds, latenessMin };
});
