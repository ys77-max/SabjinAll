import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';
import { db, hh, FieldValue, REGION, toMs } from './lib/admin';
import { addDays, dayOfWeek, istDateString, istHour, nextDeliveryAfter } from './lib/time';
import { proposeOrder, type Category, type EngineItem, type Unit } from './engine';
import { notifyHousehold } from './lib/fcm';
import { notifyCopy } from './i18n/notify';
import type { Lang } from './i18n/units';

const DEFAULT_DRAFT_HOUR = 7; // IST — "the morning before"

export const orderIdFor = (vendorId: string, forDate: string) => `${vendorId}_${forDate}`;

/**
 * Hourly. For every active vendor delivering tomorrow (IST) whose household's draft hour has
 * passed and that has no order for that date yet, generate a draft order.
 */
export const proposeOrders = onSchedule(
  { schedule: 'every 60 minutes', timeZone: 'Asia/Kolkata', region: REGION, timeoutSeconds: 300 },
  async () => {
    const now = new Date();
    const forDate = addDays(istDateString(now), 1);
    const dow = dayOfWeek(forDate);
    const vendors = await db.collectionGroup('vendors').where('deliveryDays', 'array-contains', dow).get();

    for (const v of vendors.docs) {
      if (v.get('isActive') === false) continue;
      const householdRef = v.ref.parent.parent as DocumentReference;
      try {
        await proposeForVendor(householdRef.id, v.id, forDate, now);
      } catch (err) {
        logger.error('proposeForVendor failed', { householdId: householdRef.id, vendorId: v.id, err });
      }
    }
  },
);

export async function proposeForVendor(householdId: string, vendorId: string, forDate: string, now: Date, force = false) {
  const h = hh(householdId);
  const [household, vendor] = await Promise.all([h.get(), h.collection('vendors').doc(vendorId).get()]);
  if (!household.exists || !vendor.exists) return null;

  const draftHour: number = household.get('notifyDraftHour') ?? DEFAULT_DRAFT_HOUR;
  if (!force && istHour(now) < draftHour) return null;

  const orderRef = h.collection('orders').doc(orderIdFor(vendorId, forDate));
  // "no draft exists for that date" — any order (deterministic id or manual) for this vendor + date
  const existing = await h.collection('orders').where('forDate', '==', forDate).where('vendorId', '==', vendorId).limit(1).get();
  if (!existing.empty || (await orderRef.get()).exists) return null;

  const [itemsSnap, queueSnap, prevSnap, recentSnap, festSnap] = await Promise.all([
    h.collection('items').get(),
    h.collection('nextOrderQueue').get(),
    h.collection('orders').where('vendorId', '==', vendorId).where('forDate', '<', forDate).orderBy('forDate', 'desc').limit(4).get(),
    h.collection('orders').where('forDate', '>=', addDays(forDate, -21)).where('forDate', '<', forDate).get(),
    db.collection('festivals').where('date', '>=', forDate).where('date', '<=', addDays(forDate, 6)).get(),
  ]);

  const items: EngineItem[] = itemsSnap.docs.map((d) => ({
    id: d.id,
    category: d.get('category'),
    defaultUnit: d.get('defaultUnit'),
    defaultQty: d.get('defaultQty') ?? 1,
    shelfLifeDays: d.get('shelfLifeDays') ?? 5,
    effectiveShelfLifeDays: d.get('effectiveShelfLifeDays') ?? undefined,
    seasonMonths: d.get('seasonMonths') ?? [],
    peakMonths: d.get('peakMonths') ?? [],
    rotation: d.get('rotation') ?? 'on_demand',
    isPinned: !!d.get('isPinned'),
    isHidden: !!d.get('isHidden'),
    vendorId: d.get('vendorId') ?? null,
    lastReceivedAt: toMs(d.get('lastReceivedAt')),
    lastFinishedAt: toMs(d.get('lastFinishedAt')),
    halfLeftAt: toMs(d.get('halfLeftAt')),
    medianKeptQty: d.get('medianKeptQty') ?? null,
  }));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const vendorCategories: Category[] = vendor.get('categories') ?? [];
  const serves = (itemId: string) => {
    const it = itemById.get(itemId);
    return (
      !!it &&
      (it.vendorId === null || it.vendorId === vendorId) &&
      (vendorCategories.length === 0 || vendorCategories.includes(it.category))
    );
  };

  // Rule 1 inputs — most recent delivered order not yet carried
  const prevOrders = prevSnap.docs.filter((d) => d.get('status') !== 'cancelled' && d.get('status') !== 'draft');
  const lastDelivered = prevOrders.find((d) => ['received', 'partially_received'].includes(d.get('status')));
  const carry: { itemId: string; qty: number; unit: Unit }[] = [];
  if (lastDelivered && !lastDelivered.get('carriedInto')) {
    const its = await lastDelivered.ref.collection('items').get();
    for (const d of its.docs) {
      const rs = d.get('receivedStatus');
      if (d.get('status') === 'removed') continue;
      if (rs === 'not_seen') carry.push({ itemId: d.id, qty: d.get('qty'), unit: d.get('unit') });
      if (rs === 'short') {
        const left = (d.get('qty') ?? 0) - (d.get('receivedQty') ?? 0);
        if (left > 0) carry.push({ itemId: d.id, qty: left, unit: d.get('unit') });
      }
    }
  }

  const queue = queueSnap.docs
    .filter((d) => serves(d.id))
    .map((d) => ({ itemId: d.id, qty: d.get('qty'), unit: d.get('unit'), addedByUid: d.get('addedByUid') }));

  const lastOrderAt = prevOrders.length ? toMs(prevOrders[0].get('sentAt')) ?? toMs(prevOrders[0].get('generatedAt')) : null;

  const recentlyOrderedIds = new Set<string>();
  await Promise.all(
    recentSnap.docs
      .filter((d) => d.get('status') !== 'cancelled' && d.get('status') !== 'draft')
      .map(async (o) => {
        const its = await o.ref.collection('items').get();
        its.docs.forEach((i) => i.get('status') !== 'removed' && recentlyOrderedIds.add(i.id));
      }),
  );

  const region = household.get('region') ?? 'west-india';
  const festivals = festSnap.docs
    .filter((f) => ['all', region].includes(f.get('region')))
    .map((f) => ({ name: f.get('name') as string, date: f.get('date') as string }));

  const out = proposeOrder({
    forDate,
    nextDeliveryDate: nextDeliveryAfter(forDate, vendor.get('deliveryDays') ?? []),
    vendorId,
    vendorCategories,
    items,
    carry,
    queue,
    lastOrderAt,
    recentlyOrderedIds: [...recentlyOrderedIds],
    festivals,
  });

  const language: Lang = vendor.get('language') ?? 'hi';
  const batch = db.batch();
  batch.create(orderRef, {
    vendorId,
    forDate,
    status: 'draft',
    generatedAt: FieldValue.serverTimestamp(),
    approvedAt: null,
    sentAt: null,
    receivedAt: null,
    messageText: null,
    language,
    reminderCount: 0,
    latenessMin: null,
    notes: '',
    skipped: out.skipped,
    peakItemIds: out.peakItemIds,
    festivalBanner: out.festivalBanner,
    notices: [],
    totalSpend: null,
  });
  for (const l of out.lines) {
    batch.set(orderRef.collection('items').doc(l.itemId), {
      qty: l.qty,
      unit: l.unit,
      reason: l.reason,
      addedByUid: l.addedByUid,
      status: 'proposed',
      receivedStatus: null,
      receivedQty: null,
      photoConfidence: null,
      price: null,
    });
  }
  // Rule 2 — clear consumed queue entries into the draft
  for (const q of queue) batch.delete(h.collection('nextOrderQueue').doc(q.itemId));
  if (lastDelivered && carry.length) batch.update(lastDelivered.ref, { carriedInto: orderRef.id });
  await batch.commit();

  const hhLang: Lang = household.get('languagePref') ?? 'en';
  const copy = notifyCopy.draftReady(hhLang, dayOfWeek(forDate));
  await notifyHousehold(householdId, { ...copy, link: `/order/${orderRef.id}`, tag: `draft_${orderRef.id}` });
  logger.info('draft created', { householdId, orderId: orderRef.id, lines: out.lines.length });
  return orderRef.id;
}
