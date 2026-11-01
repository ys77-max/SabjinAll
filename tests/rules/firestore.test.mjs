// Firestore security rules tests. Run with: npm run test:rules
// (starts the Firestore + Storage emulators via `firebase emulators:exec`).
import { before, after, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  setLogLevel, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, Timestamp, increment, arrayUnion,
} from 'firebase/firestore';

const PROJECT = 'demo-sabzilist-rules';
let env;

/** h1: alice (owner) + bob (member). h2: eve (owner). */
async function seed() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Timestamp.now();
    await setDoc(doc(db, 'users/alice'), { householdId: 'h1' });
    await setDoc(doc(db, 'users/bob'), { householdId: 'h1' });
    await setDoc(doc(db, 'users/eve'), { householdId: 'h2' });
    await setDoc(doc(db, 'seedItems/spinach'), { nameEn: 'Spinach' });
    await setDoc(doc(db, 'festivals/diwali'), { name: 'Diwali', date: '2026-11-08', region: 'all' });
    for (const [h, owner] of [['h1', 'alice'], ['h2', 'eve']]) {
      await setDoc(doc(db, `households/${h}`), { name: h, city: 'Pune', languagePref: 'mr', inviteCode: `CODE${h}`, createdAt: now });
      await setDoc(doc(db, `households/${h}/members/${owner}`), { name: owner, phone: '', role: 'owner', fcmTokens: [] });
      await setDoc(doc(db, `households/${h}/vendors/v1`), { name: 'Ramesh', whatsappNumber: '919822012345', language: 'mr' });
      await setDoc(doc(db, `households/${h}/items/spinach`), {
        nameEn: 'Spinach', nameHi: 'पालक', nameMr: 'पालक', category: 'leafy', defaultUnit: 'bunch', defaultQty: 2,
        shelfLifeDays: 3, seasonMonths: [], rotation: 'weekly', isPinned: false, isHidden: false, vendorId: null,
        lastReceivedAt: null, lastFinishedAt: null, stockState: 'unknown', skipStreak: 0, addStreak: 0, medianKeptQty: null,
      });
      for (const [id, status] of [['draft', 'draft'], ['approved', 'approved'], ['sent', 'sent'], ['received', 'received']]) {
        await setDoc(doc(db, `households/${h}/orders/${id}`), {
          vendorId: 'v1', forDate: '2026-11-04', status, reminderCount: 0, latenessMin: null, messageText: null, notes: '',
          sentAt: status === 'sent' ? now : null,
        });
        await setDoc(doc(db, `households/${h}/orders/${id}/items/spinach`), {
          qty: 2, unit: 'bunch', reason: 'rotation', addedByUid: null, status: 'proposed',
          receivedStatus: null, receivedQty: null, photoConfidence: null, price: null,
        });
      }
    }
    await setDoc(doc(db, 'households/h1/members/bob'), { name: 'bob', phone: '', role: 'member', fcmTokens: [] });
    await setDoc(doc(db, 'households/h1/stockEvents/e1'), { itemId: 'spinach', kind: 'finished', qty: 2, unit: 'bunch', source: 'tap', at: now, byUid: 'alice' });
    await setDoc(doc(db, 'households/h1/messages/m1'), { orderId: 'sent', vendorId: 'v1', kind: 'order', text: 'x', language: 'mr', channel: 'wa_link', sentAt: now, byUid: 'alice' });
    await setDoc(doc(db, 'households/h1/orders/sent/photos/p1'), { storagePath: 'households/h1/orders/sent/p1.jpg', takenAt: now, expiresAt: now });
  });
}

const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();
const tapEvent = (byUid, over = {}) => ({ itemId: 'spinach', kind: 'finished', qty: 2, unit: 'bunch', source: 'tap', at: Timestamp.now(), byUid, ...over });

before(async () => {
  setLogLevel('silent');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await seed();
});

describe('global data', () => {
  test('signed-in users read seedItems / festivals; anonymous cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'seedItems/spinach')));
    await assertSucceeds(getDoc(doc(as('eve'), 'festivals/diwali')));
    await assertFails(getDoc(doc(anon(), 'seedItems/spinach')));
  });
  test('nobody writes seedItems / festivals / seasonCalendar from the client', async () => {
    await assertFails(setDoc(doc(as('alice'), 'seedItems/x'), { nameEn: 'X' }));
    await assertFails(setDoc(doc(as('alice'), 'festivals/x'), { name: 'X' }));
    await assertFails(setDoc(doc(as('alice'), 'seasonCalendar/west-india/items/x'), { startMonth: 1 }));
  });
  test('users/{uid}: read own only, never write', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'users/alice')));
    await assertFails(getDoc(doc(as('alice'), 'users/bob')));
    await assertFails(setDoc(doc(as('alice'), 'users/alice'), { householdId: 'h2' }));
    await assertFails(setDoc(doc(as('mallory'), 'users/mallory'), { householdId: 'h1' }));
  });
});

describe('household isolation', () => {
  test('members read their household; outsiders and anonymous cannot', async () => {
    await assertSucceeds(getDoc(doc(as('alice'), 'households/h1')));
    await assertSucceeds(getDoc(doc(as('bob'), 'households/h1/orders/draft')));
    await assertFails(getDoc(doc(as('eve'), 'households/h1')));
    await assertFails(getDoc(doc(anon(), 'households/h1')));
  });
  test('outsiders cannot read or write any subcollection', async () => {
    for (const p of ['members/alice', 'vendors/v1', 'items/spinach', 'stockEvents/e1', 'orders/draft',
      'orders/draft/items/spinach', 'orders/sent/photos/p1', 'messages/m1']) {
      await assertFails(getDoc(doc(as('eve'), `households/h1/${p}`)));
    }
    await assertFails(setDoc(doc(as('eve'), 'households/h1/vendors/v2'), { name: 'x' }));
    await assertFails(addDoc(collection(as('eve'), 'households/h1/stockEvents'), tapEvent('eve')));
    await assertFails(setDoc(doc(as('eve'), 'households/h1/nextOrderQueue/spinach'), { qty: 1, unit: 'bunch', addedByUid: 'eve' }));
  });
});

describe('households/{h}', () => {
  test('client cannot create or delete households', async () => {
    await assertFails(setDoc(doc(as('mallory'), 'households/h3'), { name: 'x' }));
    await assertFails(deleteDoc(doc(as('alice'), 'households/h1')));
  });
  test('owner edits settings fields only', async () => {
    await assertSucceeds(updateDoc(doc(as('alice'), 'households/h1'), { name: 'Patil ghar', languagePref: 'hi', notifyDraftHour: 6 }));
    await assertFails(updateDoc(doc(as('alice'), 'households/h1'), { inviteCode: 'HACKED' }));
  });
  test('non-owner member cannot edit the household', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'households/h1'), { name: 'Bob house' }));
  });
});

describe('members', () => {
  test('nobody can self-add (only joinHousehold callable)', async () => {
    await assertFails(setDoc(doc(as('eve'), 'households/h1/members/eve'), { name: 'eve', role: 'member', fcmTokens: [] }));
    await assertFails(setDoc(doc(as('bob'), 'households/h1/members/carol'), { name: 'carol', role: 'member', fcmTokens: [] }));
  });
  test('member updates own name / fcmTokens but not role or others', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), 'households/h1/members/bob'), { fcmTokens: arrayUnion('tok'), name: 'Bob' }));
    await assertFails(updateDoc(doc(as('bob'), 'households/h1/members/bob'), { role: 'owner' }));
    await assertFails(updateDoc(doc(as('bob'), 'households/h1/members/alice'), { name: 'x' }));
  });
  test('owner removes others; member may leave; owner cannot remove self', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'households/h1/members/alice')));
    await assertFails(deleteDoc(doc(as('alice'), 'households/h1/members/alice')));
    await assertSucceeds(deleteDoc(doc(as('bob'), 'households/h1/members/bob')));
    await seed();
    await assertSucceeds(deleteDoc(doc(as('alice'), 'households/h1/members/bob')));
  });
});

describe('vendors', () => {
  test('members manage vendors', async () => {
    await assertSucceeds(setDoc(doc(as('bob'), 'households/h1/vendors/v2'), { name: 'Sunil', whatsappNumber: '9800000000' }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'households/h1/vendors/v1'), { usualDeliveryTime: '09:30' }));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'households/h1/vendors/v2')));
  });
});

describe('items', () => {
  const itemPath = 'households/h1/items/spinach';
  test('members edit catalogue fields', async () => {
    await assertSucceeds(updateDoc(doc(as('bob'), itemPath), { rotation: 'biweekly', isPinned: true, nameMr: 'पालक भाजी' }));
  });
  test('pantry belief and learning fields are Function-only', async () => {
    for (const patch of [
      { lastReceivedAt: Timestamp.now() }, { lastFinishedAt: Timestamp.now() }, { stockState: 'full' },
      { skipStreak: 5 }, { addStreak: 2 }, { medianKeptQty: 3 }, { halfLeftAt: Timestamp.now() }, { keptQtyHistory: [1] }, { effectiveShelfLifeDays: 30 }, { addHistory: [] },
    ]) {
      await assertFails(updateDoc(doc(as('alice'), itemPath), patch));
    }
  });
  test('create a custom item; cannot smuggle learning fields', async () => {
    const base = { nameEn: 'Kokum', nameHi: 'कोकम', nameMr: 'कोकम', category: 'fruit', defaultUnit: 'g', defaultQty: 250,
      shelfLifeDays: 5, seasonMonths: [4, 5], rotation: 'on_demand', isPinned: false, isHidden: false, vendorId: null,
      lastReceivedAt: null, lastFinishedAt: null, stockState: 'unknown', skipStreak: 0, addStreak: 0 };
    await assertSucceeds(setDoc(doc(as('alice'), 'households/h1/items/kokum'), base));
    await assertFails(setDoc(doc(as('alice'), 'households/h1/items/kokum2'), { ...base, medianKeptQty: 5 }));
    await assertFails(setDoc(doc(as('alice'), 'households/h1/items/kokum3'), { ...base, lastReceivedAt: Timestamp.now() }));
    await assertFails(setDoc(doc(as('alice'), 'households/h1/items/kokum4'), { ...base, defaultQty: 'lots' }));
  });
});

describe('stockEvents (append-only)', () => {
  const col = (uid) => collection(as(uid), 'households/h1/stockEvents');
  test('member records a tap event as themselves', async () => {
    await assertSucceeds(addDoc(col('bob'), tapEvent('bob')));
    await assertSucceeds(addDoc(col('bob'), tapEvent('bob', { kind: 'manual_set', qty: 0.5 })));
  });
  test('cannot impersonate, fake a source, or invent a kind', async () => {
    await assertFails(addDoc(col('bob'), tapEvent('alice')));
    await assertFails(addDoc(col('bob'), tapEvent('bob', { source: 'order' })));
    await assertFails(addDoc(col('bob'), tapEvent('bob', { kind: 'stolen' })));
    await assertFails(addDoc(col('bob'), tapEvent('bob', { qty: 'two' })));
  });
  test('no update or delete', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'households/h1/stockEvents/e1'), { qty: 1 }));
    await assertFails(deleteDoc(doc(as('alice'), 'households/h1/stockEvents/e1')));
  });
});

describe('orders', () => {
  const o = (uid, id) => doc(as(uid), `households/h1/orders/${id}`);
  test('client cannot create or delete orders', async () => {
    await assertFails(setDoc(o('alice', 'new'), { vendorId: 'v1', forDate: '2026-11-11', status: 'draft' }));
    await assertFails(deleteDoc(o('alice', 'draft')));
  });
  test('mark sent only after approval (buildMessage)', async () => {
    await assertFails(updateDoc(o('alice', 'draft'), { status: 'sent', sentAt: Timestamp.now() }));
    await assertSucceeds(updateDoc(o('alice', 'approved'), { status: 'sent', sentAt: Timestamp.now() }));
  });
  test('reminder increments reminderCount by exactly one', async () => {
    await assertSucceeds(updateDoc(o('bob', 'sent'), { status: 'reminded', reminderCount: increment(1) }));
    await assertFails(updateDoc(o('bob', 'sent'), { reminderCount: increment(2) }));
    await assertFails(updateDoc(o('bob', 'sent'), { reminderCount: 0, status: 'reminded', notes: 'x', sentAt: null, latenessMin: 0 }));
  });
  test('cancel from active states only', async () => {
    await assertSucceeds(updateDoc(o('alice', 'draft'), { status: 'cancelled' }));
    await assertFails(updateDoc(o('alice', 'received'), { status: 'cancelled' }));
    await assertFails(updateDoc(o('alice', 'sent'), { status: 'received' }));
    await assertFails(updateDoc(o('alice', 'sent'), { status: 'draft' }));
  });
  test('Function-owned fields are read-only to clients', async () => {
    for (const patch of [
      { latenessMin: 5 }, { messageText: 'hacked' }, { generatedAt: Timestamp.now() }, { approvedAt: Timestamp.now() },
      { receivedAt: Timestamp.now() }, { totalSpend: 1 }, { learningApplied: true }, { promptedCount: 2 },
    ]) {
      await assertFails(updateDoc(o('alice', 'sent'), patch));
    }
    await assertSucceeds(updateDoc(o('alice', 'sent'), { notes: 'leave at gate' }));
  });
});

describe('order items', () => {
  const it = (uid, order, id = 'spinach') => doc(as(uid), `households/h1/orders/${order}/items/${id}`);
  const added = { qty: 1, unit: 'kg', reason: 'manual', addedByUid: 'bob', status: 'added', receivedStatus: null, receivedQty: null, photoConfidence: null, price: null };
  test('members edit qty / unit / status / price', async () => {
    await assertSucceeds(updateDoc(it('bob', 'draft'), { qty: 3, unit: 'bunch', status: 'removed' }));
    await assertSucceeds(updateDoc(it('alice', 'received'), { price: 20 }));
  });
  test('recognition and receipt fields are Function-only', async () => {
    await assertFails(updateDoc(it('alice', 'sent'), { photoConfidence: 0.9 }));
    await assertFails(updateDoc(it('alice', 'sent'), { receivedStatus: 'received' }));
    await assertFails(updateDoc(it('alice', 'sent'), { receivedQty: 2 }));
    await assertFails(updateDoc(it('alice', 'draft'), { reason: 'shortage_carry' }));
  });
  test('add items only to draft/approved orders, as "added"', async () => {
    await assertSucceeds(setDoc(it('bob', 'draft', 'tomato'), added));
    await assertSucceeds(setDoc(it('bob', 'approved', 'tomato'), added));
    await assertFails(setDoc(it('bob', 'sent', 'tomato'), added));
    await assertFails(setDoc(it('bob', 'draft', 'onion'), { ...added, status: 'proposed' }));
    await assertFails(setDoc(it('bob', 'draft', 'okra'), { ...added, photoConfidence: 1 }));
  });
  test('no deletes (removal is status=removed)', async () => {
    await assertFails(deleteDoc(it('alice', 'draft')));
  });
});

describe('photos', () => {
  const p = (uid, id) => doc(as(uid), `households/h1/orders/sent/photos/${id}`);
  const meta = (path) => ({ storagePath: path, takenAt: Timestamp.now(), expiresAt: Timestamp.now() });
  test('member registers a photo under this order', async () => {
    await assertSucceeds(setDoc(p('bob', 'p2'), meta('households/h1/orders/sent/p2.jpg')));
  });
  test('cannot point at another household/order or pre-fill recognition', async () => {
    await assertFails(setDoc(p('bob', 'p3'), meta('households/h2/orders/sent/p3.jpg')));
    await assertFails(setDoc(p('bob', 'p4'), meta('households/h1/orders/draft/p4.jpg')));
    await assertFails(setDoc(p('bob', 'p5'), { ...meta('households/h1/orders/sent/p5.jpg'), recognition: [] }));
  });
  test('recognition is written by recogniseDelivery only', async () => {
    await assertFails(updateDoc(p('alice', 'p1'), { recognition: [{ itemId: 'spinach', seen: true, confidence: 1 }] }));
    await assertFails(deleteDoc(p('alice', 'p1')));
  });
});

describe('messages (append-only log)', () => {
  const col = (uid) => collection(as(uid), 'households/h1/messages');
  const msg = (byUid, over = {}) => ({ orderId: 'sent', vendorId: 'v1', kind: 'reminder', text: 'x', language: 'mr', channel: 'wa_link', sentAt: Timestamp.now(), byUid, ...over });
  test('member logs a message as themselves', async () => {
    await assertSucceeds(addDoc(col('bob'), msg('bob')));
  });
  test('no impersonation, unknown kinds, edits or deletes', async () => {
    await assertFails(addDoc(col('bob'), msg('alice')));
    await assertFails(addDoc(col('bob'), msg('bob', { kind: 'spam' })));
    await assertFails(updateDoc(doc(as('alice'), 'households/h1/messages/m1'), { text: 'edited' }));
    await assertFails(deleteDoc(doc(as('alice'), 'households/h1/messages/m1')));
  });
});

describe('nextOrderQueue', () => {
  const q = (uid, id = 'spinach') => doc(as(uid), `households/h1/nextOrderQueue/${id}`);
  test('member queues an item as themselves and can remove it', async () => {
    await assertSucceeds(setDoc(q('bob'), { qty: 2, unit: 'bunch', addedByUid: 'bob', addedAt: Timestamp.now() }));
    await assertSucceeds(deleteDoc(q('alice')));
  });
  test('cannot queue on behalf of someone else', async () => {
    await assertFails(setDoc(q('bob'), { qty: 2, unit: 'bunch', addedByUid: 'alice', addedAt: Timestamp.now() }));
    await assertFails(setDoc(q('bob'), { qty: 'lots', unit: 'bunch', addedByUid: 'bob', addedAt: Timestamp.now() }));
  });
});
