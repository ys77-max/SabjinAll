import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const messaging = getMessaging();
export const storage = getStorage();
export { FieldValue, Timestamp };

export const REGION = 'asia-south1';

/** Shared options for callables: App Check enforced, region pinned. */
export const callableOpts = { region: REGION, enforceAppCheck: true } as const;

export const hh = (householdId: string) => db.collection('households').doc(householdId);

export function requireAuth(req: CallableRequest<unknown>): string {
  if (!req.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  return req.auth.uid;
}

/** Throws unless uid is a member of the household. */
export async function requireMember(householdId: string, uid: string) {
  if (typeof householdId !== 'string' || !householdId) {
    throw new HttpsError('invalid-argument', 'householdId required');
  }
  const snap = await hh(householdId).collection('members').doc(uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'Not a member of this household.');
  return snap;
}

export function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new HttpsError('invalid-argument', `${name} required`);
  return v;
}

export function toMs(t: unknown): number | null {
  if (!t) return null;
  if (t instanceof Timestamp) return t.toMillis();
  if (typeof (t as { toMillis?: unknown }).toMillis === 'function') return (t as Timestamp).toMillis();
  return null;
}
