import { getToken, onMessage } from 'firebase/messaging';
import { arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db, getMessagingSafe } from './firebase';

/** Ask permission, get an FCM token bound to our service worker, store it on the member doc. */
export async function enablePush(householdId: string, uid: string): Promise<boolean> {
  const messaging = await getMessagingSafe();
  if (!messaging || !('Notification' in window)) return false;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  });
  if (!token) return false;
  await updateDoc(doc(db, 'households', householdId, 'members', uid), { fcmTokens: arrayUnion(token) });
  return true;
}

/** Foreground messages: show a system notification too (data-only payloads). */
export async function listenForeground() {
  const messaging = await getMessagingSafe();
  if (!messaging) return;
  onMessage(messaging, async (payload) => {
    const d = payload.data ?? {};
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification(d.title ?? 'SabziList', {
      body: d.body,
      tag: d.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { link: d.link ?? '/home' },
    });
  });
}
