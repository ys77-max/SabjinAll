import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { randomInt } from 'node:crypto';
import { db, hh, FieldValue, callableOpts, requireAuth } from './lib/admin';
import seedJson from './seed/seedItems.json';

const MAX_MEMBERS = 6;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

const clean = (v: unknown, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function existingHousehold(uid: string): Promise<string | null> {
  const u = await db.collection('users').doc(uid).get();
  return (u.exists && (u.get('householdId') as string)) || null;
}

/** First login: create a household, make the caller owner, copy the seed catalogue in. */
export const createHousehold = onCall(callableOpts, async (req) => {
  const uid = requireAuth(req);
  const prior = await existingHousehold(uid);
  if (prior) return { householdId: prior };

  const d = (req.data ?? {}) as Record<string, unknown>;
  const lang = ['en', 'hi', 'mr'].includes(d.languagePref as string) ? (d.languagePref as string) : 'mr';
  const householdRef = db.collection('households').doc();

  // Global catalogue (admin-seeded); fall back to the bundled JSON if not seeded yet.
  const seedSnap = await db.collection('seedItems').get();
  const seeds: Record<string, unknown>[] = seedSnap.empty
    ? (seedJson as Record<string, unknown>[])
    : seedSnap.docs.map((s) => ({ id: s.id, ...s.data() }));

  let code = newCode();
  for (let i = 0; i < 5; i++) {
    const clash = await db.collection('households').where('inviteCode', '==', code).limit(1).get();
    if (clash.empty) break;
    code = newCode();
  }

  const batch = db.batch();
  batch.set(householdRef, {
    name: clean(d.name) || 'Home',
    city: clean(d.city) || 'Pune',
    region: 'west-india',
    languagePref: lang,
    inviteCode: code,
    createdAt: FieldValue.serverTimestamp(),
    notifyDraftHour: 7,
    notifyDeliveryDue: true,
  });
  batch.set(householdRef.collection('members').doc(uid), {
    name: clean(d.memberName) || 'Me',
    phone: req.auth?.token.phone_number ?? '',
    role: 'owner',
    fcmTokens: [],
  });
  batch.set(db.collection('users').doc(uid), { householdId: householdRef.id });
  for (const s of seeds) {
    const { id, ...rest } = s as { id: string } & Record<string, unknown>;
    batch.set(householdRef.collection('items').doc(id), {
      ...rest,
      isPinned: false,
      isHidden: false,
      vendorId: null,
      lastReceivedAt: null,
      lastFinishedAt: null,
      halfLeftAt: null,
      stockState: 'unknown',
      skipStreak: 0,
      addStreak: 0,
      addHistory: [],
      medianKeptQty: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { householdId: householdRef.id };
});

/** /join/:code — link a second member. Members cannot add themselves via client writes. */
export const joinHousehold = onCall(callableOpts, async (req) => {
  const uid = requireAuth(req);
  const d = (req.data ?? {}) as Record<string, unknown>;
  const code = clean(d.code, 12).toUpperCase();
  if (!code) throw new HttpsError('invalid-argument', 'Invite code required');

  const prior = await existingHousehold(uid);
  const match = await db.collection('households').where('inviteCode', '==', code).limit(1).get();
  if (match.empty) throw new HttpsError('not-found', 'Invalid invite code');
  const householdId = match.docs[0].id;
  if (prior === householdId) return { householdId };
  if (prior) throw new HttpsError('failed-precondition', 'You already belong to a household');

  await db.runTransaction(async (tx) => {
    const members = await tx.get(hh(householdId).collection('members'));
    if (members.size >= MAX_MEMBERS) throw new HttpsError('resource-exhausted', 'Household is full');
    tx.set(hh(householdId).collection('members').doc(uid), {
      name: clean(d.memberName) || 'Member',
      phone: req.auth?.token.phone_number ?? '',
      role: 'member',
      fcmTokens: [],
    });
    tx.set(db.collection('users').doc(uid), { householdId });
  });
  return { householdId };
});
