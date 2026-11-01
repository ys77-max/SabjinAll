import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db, hh, FieldValue, callableOpts, requireAuth, requireMember, str } from './lib/admin';
import { dayOfWeek } from './lib/time';
import { applyLearning, CATEGORY_ORDER, type DraftOutcome, type Rotation } from './engine';
import { buildOrderText, localName, type Lang, type Unit } from './i18n/units';

/**
 * Callable on Approve (and on Resend). Builds the numbered vendor message in the vendor's
 * language. On the first approval it also runs rule 7 (skip learning) and sets status=approved.
 * The client then opens wa.me and marks the order sent.
 */
export const buildMessage = onCall(callableOpts, async (req) => {
  const uid = requireAuth(req);
  const { householdId, orderId } = (req.data ?? {}) as Record<string, unknown>;
  const hid = str(householdId, 'householdId');
  const oid = str(orderId, 'orderId');
  await requireMember(hid, uid);

  const h = hh(hid);
  const orderRef = h.collection('orders').doc(oid);
  const order = await orderRef.get();
  if (!order.exists) throw new HttpsError('not-found', 'Order not found');
  const status = order.get('status');
  if (status === 'cancelled' || status === 'received' || status === 'partially_received') {
    throw new HttpsError('failed-precondition', `Order is ${status}`);
  }

  const vendor = await h.collection('vendors').doc(order.get('vendorId')).get();
  if (!vendor.exists) throw new HttpsError('failed-precondition', 'Vendor missing');
  const lang: Lang = vendor.get('language') ?? 'hi';

  const [lineSnap, itemsSnap] = await Promise.all([orderRef.collection('items').get(), h.collection('items').get()]);
  const itemById = new Map(itemsSnap.docs.map((d) => [d.id, d]));

  const active = lineSnap.docs
    .filter((l) => l.get('status') !== 'removed' && itemById.has(l.id))
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(itemById.get(a.id)!.get('category')) -
        CATEGORY_ORDER.indexOf(itemById.get(b.id)!.get('category')),
    );
  if (!active.length) throw new HttpsError('failed-precondition', 'The list is empty');

  const text = buildOrderText({
    lang,
    vendorName: vendor.get('name'),
    dayIndex: dayOfWeek(order.get('forDate')),
    time: vendor.get('usualDeliveryTime') ?? '10:00',
    lines: active.map((l) => {
      const it = itemById.get(l.id)!;
      return {
        name: localName({ nameEn: it.get('nameEn'), nameHi: it.get('nameHi'), nameMr: it.get('nameMr') }, lang),
        qty: l.get('qty'),
        unit: l.get('unit') as Unit,
      };
    }),
  });

  const batch = db.batch();
  const update: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = { messageText: text, language: lang };

  if (status === 'draft' && !order.get('learningApplied')) {
    // Rule 7 — skip learning across every catalogue line that was in or added to the draft
    const now = Date.now();
    const notices: { itemId: string; code: string }[] = [];
    for (const l of lineSnap.docs) {
      const it = itemById.get(l.id);
      if (!it) continue;
      const ls = l.get('status');
      const reason = l.get('reason');
      let outcome: DraftOutcome;
      if (ls === 'added') outcome = 'added';
      else if (ls === 'removed') outcome = reason === 'manual' || reason === 'member_added' ? 'not_in_draft' : 'removed';
      else outcome = 'kept';

      const res = applyLearning(
        {
          rotation: (it.get('rotation') ?? 'on_demand') as Rotation,
          skipStreak: it.get('skipStreak') ?? 0,
          addStreak: it.get('addStreak') ?? 0,
          addHistory: (it.get('addHistory') ?? []) as number[],
        },
        outcome,
        now,
      );
      batch.update(it.ref, {
        rotation: res.rotation,
        skipStreak: res.skipStreak,
        addStreak: res.addStreak,
        addHistory: res.addHistory,
      });
      if (res.notice) notices.push({ itemId: l.id, code: res.notice });
    }
    Object.assign(update, {
      status: 'approved',
      approvedAt: FieldValue.serverTimestamp(),
      learningApplied: true,
      notices,
    });
  }

  batch.update(orderRef, update);
  await batch.commit();
  return { text, whatsappNumber: vendor.get('whatsappNumber') as string };
});
