import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  waitForPendingWrites,
} from 'firebase/firestore';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { getMessaging, isSupported as messagingSupported, type Messaging } from 'firebase/messaging';

const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);

// App Check must be initialised before other services make requests.
if (env.VITE_APPCHECK_DEBUG === 'true') {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
}
if (env.VITE_FIREBASE_APPCHECK_SITE_KEY) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.VITE_FIREBASE_APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);

// Offline-first: IndexedDB cache shared across tabs; writes queue while offline and sync later.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
export const functions = getFunctions(app, env.VITE_FUNCTIONS_REGION || 'asia-south1');

// Local development against `firebase emulators:start`
if (env.VITE_USE_EMULATORS === 'true') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

let messagingPromise: Promise<Messaging | null> | null = null;
export function getMessagingSafe(): Promise<Messaging | null> {
  messagingPromise ??= messagingSupported().then((ok) => (ok ? getMessaging(app) : null)).catch(() => null);
  return messagingPromise;
}

/** Callables read server state; flush queued local writes first (bounded so a flaky network can't hang the UI). */
export async function flushWrites(ms = 8000) {
  await Promise.race([waitForPendingWrites(db), new Promise((r) => setTimeout(r, ms))]);
}

/* ---------- typed callables ---------- */
type Lines = { itemId: string; receivedStatus: string; receivedQty: number | null; price?: number | null }[];

export const callables = {
  createHousehold: httpsCallable<
    { name: string; city: string; languagePref: string; memberName: string },
    { householdId: string }
  >(functions, 'createHousehold'),
  joinHousehold: httpsCallable<{ code: string; memberName: string }, { householdId: string }>(functions, 'joinHousehold'),
  buildMessage: httpsCallable<{ householdId: string; orderId: string }, { text: string; whatsappNumber: string }>(
    functions,
    'buildMessage',
  ),
  generateDraftNow: httpsCallable<{ householdId: string; vendorId: string }, { orderId: string; forDate: string }>(
    functions,
    'generateDraftNow',
  ),
  recogniseDelivery: httpsCallable<
    { householdId: string; orderId: string; photoId: string },
    | { fallback: true }
    | {
        fallback: false;
        items: { itemId: string; receivedStatus: 'received' | 'not_seen' | 'unsure'; confidence: number; countEstimate: number | null }[];
        extras: { label: string; confidence: number }[];
      }
  >(functions, 'recogniseDelivery', { timeout: 120_000 }),
  confirmDelivery: httpsCallable<
    { householdId: string; orderId: string; lines: Lines; extras: { itemId: string; qty: number; unit: string }[] },
    { status: string; shortItemIds: string[]; latenessMin: number }
  >(functions, 'confirmDelivery'),
};
