import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { hh, REGION } from './lib/admin';
import { subscribe, unsubscribe, notifyHousehold } from './lib/fcm';
import { notifyCopy } from './i18n/notify';
import { localName, type Lang } from './i18n/units';

/**
 * Maintains the Pantry belief on items from tap events.
 * finished → lastFinishedAt; half_left → halfLeftAt; spoiled → treated as finished and the
 * item's effective shelf life shrinks 10% (min 1 day); manual_set qty 1/0.5/0 → full/half/finished.
 * `received` events are written with the item update by confirmDelivery, except tap-sourced ones.
 */
export const onStockEvent = onDocumentCreated(
  { document: 'households/{householdId}/stockEvents/{eventId}', region: REGION },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const { householdId } = event.params;
    const e = snap.data();
    const itemRef = hh(householdId).collection('items').doc(e.itemId);
    const item = await itemRef.get();
    if (!item.exists) return;
    const at = e.at;

    switch (e.kind) {
      case 'finished':
        await itemRef.update({ lastFinishedAt: at, halfLeftAt: null, stockState: 'finished' });
        break;
      case 'half_left':
        await itemRef.update({ halfLeftAt: at, stockState: 'half' });
        break;
      case 'spoiled': {
        const base: number = item.get('effectiveShelfLifeDays') ?? item.get('shelfLifeDays') ?? 5;
        const shorter = Math.max(1, Math.round(base * 0.9 * 10) / 10);
        await itemRef.update({ lastFinishedAt: at, halfLeftAt: null, stockState: 'spoiled', effectiveShelfLifeDays: shorter });
        break;
      }
      case 'manual_set': {
        const q = Number(e.qty);
        if (q <= 0) await itemRef.update({ lastFinishedAt: at, halfLeftAt: null, stockState: 'finished' });
        else if (q < 1) await itemRef.update({ halfLeftAt: at, stockState: 'half' });
        else await itemRef.update({ lastReceivedAt: at, halfLeftAt: null, stockState: 'full' });
        break;
      }
      case 'received':
        if (e.source === 'tap') await itemRef.update({ lastReceivedAt: at, halfLeftAt: null, stockState: 'full' });
        break;
    }
  },
);

/** Keep each household's FCM topic in sync with members' tokens. */
export const onMemberWrite = onDocumentWritten(
  { document: 'households/{householdId}/members/{uid}', region: REGION },
  async (event) => {
    const before: string[] = event.data?.before.get('fcmTokens') ?? [];
    const after: string[] = event.data?.after.exists ? event.data.after.get('fcmTokens') ?? [] : [];
    const added = after.filter((t) => !before.includes(t));
    const removed = before.filter((t) => !after.includes(t));
    await Promise.all([subscribe(added, event.params.householdId), unsubscribe(removed, event.params.householdId)]);
  },
);

/** Push "member added item" when someone adds to the next-order queue. */
export const onQueueAdd = onDocumentCreated(
  { document: 'households/{householdId}/nextOrderQueue/{itemId}', region: REGION },
  async (event) => {
    const { householdId, itemId } = event.params;
    const h = hh(householdId);
    const [household, item, member] = await Promise.all([
      h.get(),
      h.collection('items').doc(itemId).get(),
      h.collection('members').doc(event.data?.get('addedByUid') ?? '_').get(),
    ]);
    if (!item.exists) return;
    const lang: Lang = household.get('languagePref') ?? 'en';
    const name = localName({ nameEn: item.get('nameEn'), nameHi: item.get('nameHi'), nameMr: item.get('nameMr') }, lang);
    await notifyHousehold(householdId, {
      ...notifyCopy.memberAdded(lang, member.get('name') ?? '—', name),
      link: '/home',
      tag: `queue_${itemId}`,
    });
  },
);
