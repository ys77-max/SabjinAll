// Loads global reference data with the Admin SDK (rules block client writes).
// Usage: GOOGLE_APPLICATION_CREDENTIALS=serviceAccount.json npm run seed
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const items = JSON.parse(readFileSync(new URL('../functions/src/seed/seedItems.json', import.meta.url), 'utf8'));

let batch = db.batch();
let n = 0;
for (const { id, peakMonths, ...rest } of items) {
  batch.set(db.collection('seedItems').doc(id), { ...rest, peakMonths });
  const sm = rest.seasonMonths;
  batch.set(db.doc(`seasonCalendar/west-india/items/${id}`), {
    startMonth: sm.length ? sm[0] : 1,
    endMonth: sm.length ? sm[sm.length - 1] : 12,
    peakMonths,
  });
  if (++n % 200 === 0) { await batch.commit(); batch = db.batch(); }
}
await batch.commit();
console.log(`seeded ${items.length} seedItems + seasonCalendar/west-india`);
