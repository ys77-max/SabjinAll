// Storage security rules tests (membership is checked against Firestore, so both emulators run).
import { before, after, beforeEach, describe, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, setLogLevel } from 'firebase/firestore';

// Cross-service rules (firestore.exists) read the default project's Firestore emulator.
const PROJECT = 'demo-sabzilist';
let env;

const put = (uid, path, bytes, contentType) =>
  env.authenticatedContext(uid).storage().ref(path).put(bytes, { contentType }).then((s) => s);
const get = (uid, path) => env.authenticatedContext(uid).storage().ref(path).getMetadata();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

before(async () => {
  setLogLevel('silent');
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
    storage: { rules: readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8') },
  });
});
after(async () => env?.cleanup());
beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'households/h1/members/alice'), { role: 'owner', fcmTokens: [] });
    await setDoc(doc(db, 'households/h2/members/eve'), { role: 'owner', fcmTokens: [] });
    await ctx.storage().ref('households/h1/orders/o1/existing.jpg').put(JPEG, { contentType: 'image/jpeg' });
  });
});

describe('delivery photos', () => {
  test('member uploads and reads a photo in their household', async () => {
    await assertSucceeds(put('alice', 'households/h1/orders/o1/p1.jpg', JPEG, 'image/jpeg'));
    await assertSucceeds(get('alice', 'households/h1/orders/o1/existing.jpg'));
  });
  test('outsiders cannot upload to or read another household', async () => {
    await assertFails(put('eve', 'households/h1/orders/o1/p2.jpg', JPEG, 'image/jpeg'));
    await assertFails(get('eve', 'households/h1/orders/o1/existing.jpg'));
  });
  test('anonymous users are denied', async () => {
    await assertFails(env.unauthenticatedContext().storage().ref('households/h1/orders/o1/existing.jpg').getMetadata());
  });
  test('images only', async () => {
    await assertFails(put('alice', 'households/h1/orders/o1/x.html', new TextEncoder().encode('<script>'), 'text/html'));
  });
  test('8 MB size limit', async () => {
    await assertSucceeds(put('alice', 'households/h1/orders/o1/big-ok.jpg', new Uint8Array(8 * 1024 * 1024 - 1), 'image/jpeg'));
    await assertFails(put('alice', 'households/h1/orders/o1/too-big.jpg', new Uint8Array(8 * 1024 * 1024 + 1), 'image/jpeg'));
  });
  test('nothing outside households/** is writable', async () => {
    await assertFails(put('alice', 'public/p.jpg', JPEG, 'image/jpeg'));
  });
});
