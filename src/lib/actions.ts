import { addDoc, collection, deleteDoc, doc, increment, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from './firebase';
import type { Item, Lang, Order, StockEventKind, Unit, Vendor } from './types';
import { buildReminderText, buildShortageText, localName } from '../../functions/src/i18n/units';

const hp = (hid: string) => `households/${hid}`;

/* Writes below go to the local cache immediately and sync when online (offline-first). */

export function recordStock(hid: string, uid: string, item: Item, kind: StockEventKind, qty = item.defaultQty) {
  return addDoc(collection(db, hp(hid), 'stockEvents'), {
    itemId: item.id,
    kind,
    qty,
    unit: item.defaultUnit,
    source: 'tap',
    at: Timestamp.now(), // client time so offline taps order correctly
    byUid: uid,
  });
}

export function queueForNextOrder(hid: string, uid: string, item: Item) {
  return setDoc(doc(db, hp(hid), 'nextOrderQueue', item.id), {
    qty: item.defaultQty,
    unit: item.defaultUnit,
    addedByUid: uid,
    addedAt: serverTimestamp(),
  });
}

export const unqueue = (hid: string, itemId: string) => deleteDoc(doc(db, hp(hid), 'nextOrderQueue', itemId));

/** Add an item to an existing draft/approved order. */
export function addToOrder(hid: string, orderId: string, uid: string, item: Item, reason: 'manual' | 'member_added' = 'manual') {
  return setDoc(doc(db, hp(hid), 'orders', orderId, 'items', item.id), {
    qty: item.defaultQty,
    unit: item.defaultUnit,
    reason,
    addedByUid: uid,
    status: 'added',
    receivedStatus: null,
    receivedQty: null,
    photoConfidence: null,
    price: null,
  });
}

export const updateOrderItem = (hid: string, orderId: string, itemId: string, patch: { qty?: number; unit?: Unit; status?: string; price?: number | null }) =>
  updateDoc(doc(db, hp(hid), 'orders', orderId, 'items', itemId), patch);

export function logMessage(hid: string, uid: string, order: Order, kind: 'order' | 'reminder' | 'shortage', text: string, language: Lang) {
  return addDoc(collection(db, hp(hid), 'messages'), {
    orderId: order.id,
    vendorId: order.vendorId,
    kind,
    text,
    language,
    channel: 'wa_link',
    sentAt: serverTimestamp(),
    byUid: uid,
  });
}

export function waLink(number: string, text: string) {
  const digits = number.replace(/[^\d]/g, '');
  const withCc = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCc}?text=${encodeURIComponent(text)}`;
}

/** Navigate to WhatsApp. Uses location so it works after an await on iOS standalone PWAs. */
export function openWhatsApp(number: string, text: string) {
  window.location.assign(waLink(number, text));
}

export async function markSent(hid: string, order: Order) {
  await updateDoc(doc(db, hp(hid), 'orders', order.id), {
    status: order.status === 'reminded' ? 'reminded' : 'sent',
    sentAt: order.sentAt ?? serverTimestamp(),
  });
}

export async function sendReminder(hid: string, uid: string, order: Order, vendor: Vendor) {
  const text = buildReminderText(vendor.language, vendor.name);
  await updateDoc(doc(db, hp(hid), 'orders', order.id), { status: 'reminded', reminderCount: increment(1) });
  await logMessage(hid, uid, order, 'reminder', text, vendor.language);
  openWhatsApp(vendor.whatsappNumber, text);
}

export async function sendShortage(hid: string, uid: string, order: Order, vendor: Vendor, items: Item[]) {
  const text = buildShortageText(vendor.language, items.map((i) => localName(i, vendor.language)));
  await logMessage(hid, uid, order, 'shortage', text, vendor.language);
  openWhatsApp(vendor.whatsappNumber, text);
}

export const cancelOrder = (hid: string, orderId: string) => updateDoc(doc(db, hp(hid), 'orders', orderId), { status: 'cancelled' });

/** Search items across EN/HI/MR names. */
export function searchItems(items: Item[], q: string, lim = 8): Item[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return items
    .filter((i) => [i.nameEn, i.nameHi, i.nameMr].some((n) => n?.toLowerCase().includes(s)))
    .sort((a, b) => Number(a.isHidden) - Number(b.isHidden) || a.nameEn.localeCompare(b.nameEn))
    .slice(0, lim);
}
