import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';
import { db, REGION } from './lib/admin';
import { istDateString, istDateTimeMs } from './lib/time';
import { notifyHousehold } from './lib/fcm';
import { notifyCopy } from './i18n/notify';
import type { Lang } from './i18n/units';

/**
 * Every 15 min. For today's sent/reminded orders, prompt a first reminder after
 * usualDeliveryTime + reminderAfterMin, and a second after + secondReminderAfterMin.
 * The push only *prompts*; the member taps it and the client opens WhatsApp and bumps reminderCount.
 * `promptedCount` stops us re-pushing the same prompt every 15 minutes.
 */
export const checkLateDeliveries = onSchedule(
  { schedule: 'every 15 minutes', timeZone: 'Asia/Kolkata', region: REGION },
  async () => {
    const now = Date.now();
    const today = istDateString(new Date(now));
    const orders = await db
      .collectionGroup('orders')
      .where('forDate', '==', today)
      .where('status', 'in', ['sent', 'reminded'])
      .get();

    for (const o of orders.docs) {
      const householdRef = o.ref.parent.parent as DocumentReference;
      try {
        const [vendor, household] = await Promise.all([
          householdRef.collection('vendors').doc(o.get('vendorId')).get(),
          householdRef.get(),
        ]);
        if (!vendor.exists) continue;
        const due = istDateTimeMs(today, vendor.get('usualDeliveryTime') ?? '10:00');
        const first = due + (vendor.get('reminderAfterMin') ?? 60) * 60_000;
        const second = due + (vendor.get('secondReminderAfterMin') ?? 180) * 60_000;
        const reminderCount: number = o.get('reminderCount') ?? 0;
        const prompted: number = o.get('promptedCount') ?? 0;
        const lang: Lang = household.get('languagePref') ?? 'en';
        const name: string = vendor.get('name');

        let level: 1 | 2 | null = null;
        if (now > second && reminderCount <= 1 && prompted < 2) level = 2;
        else if (now > first && reminderCount === 0 && prompted < 1) level = 1;
        if (!level) continue;

        await o.ref.update({ promptedCount: level });
        await notifyHousehold(householdRef.id, {
          ...notifyCopy.late(lang, name, level === 2),
          link: `/order/${o.id}?remind=1`,
          tag: `late_${o.id}`,
        });
      } catch (err) {
        logger.error('late check failed', { orderId: o.id, err });
      }
    }
  },
);
