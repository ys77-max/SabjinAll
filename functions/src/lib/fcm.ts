import { logger } from 'firebase-functions/v2';
import { messaging } from './admin';

export const householdTopic = (householdId: string) => `household_${householdId}`;

/** Push to every device in the household (all members' tokens are subscribed to the topic). */
export async function notifyHousehold(
  householdId: string,
  n: { title: string; body: string; link: string; tag?: string },
): Promise<void> {
  try {
    await messaging.send({
      topic: householdTopic(householdId),
      data: { title: n.title, body: n.body, link: n.link, tag: n.tag ?? n.link },
      webpush: {
        headers: { Urgency: 'high', TTL: String(6 * 3600) },
        fcmOptions: { link: n.link },
      },
    });
  } catch (err) {
    logger.error('FCM send failed', { householdId, err });
  }
}

export async function subscribe(tokens: string[], householdId: string) {
  if (!tokens.length) return;
  await messaging.subscribeToTopic(tokens, householdTopic(householdId));
}

export async function unsubscribe(tokens: string[], householdId: string) {
  if (!tokens.length) return;
  await messaging.unsubscribeFromTopic(tokens, householdTopic(householdId));
}
