/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
self.addEventListener('activate', () => self.clients.claim());

// App shell: Home, Pantry and the current order render from cache; Firestore serves data from IndexedDB.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const shell = createHandlerBoundToURL('/index.html');
registerRoute(
  new NavigationRoute(async (opts) => {
    try {
      return await shell(opts);
    } catch {
      return (await caches.match('/offline.html')) ?? Response.error();
    }
  }),
);

registerRoute(
  ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
  new StaleWhileRevalidate({ cacheName: 'fonts' }),
);
registerRoute(
  ({ url }) => url.hostname === 'firebasestorage.googleapis.com',
  new CacheFirst({ cacheName: 'photos', plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 7 * 86400 })] }),
);

// ---- Firebase Cloud Messaging (data-only payloads from Functions) ----
const env = import.meta.env;
if (env.VITE_FIREBASE_API_KEY) {
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  });
  onBackgroundMessage(getMessaging(app), (payload) => {
    const d = payload.data ?? {};
    return self.registration.showNotification(d.title ?? 'SabziList', {
      body: d.body,
      tag: d.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { link: d.link ?? '/home' },
    });
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link: string = event.notification.data?.link ?? '/home';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) {
        if ('focus' in c) {
          await (c as WindowClient).navigate(link).catch(() => undefined);
          return (c as WindowClient).focus();
        }
      }
      return self.clients.openWindow(link);
    })(),
  );
});
