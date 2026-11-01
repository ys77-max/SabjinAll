# SabziList

A mobile-first PWA that automates a household's weekly vegetable and fruit order to a WhatsApp vendor.

Every order day the app proposes a list (rotation + shelf life + season + "finished" taps + carry-overs). The home-maker reviews it and taps **Approve & Send**, which opens WhatsApp with a numbered list in the vendor's language (Marathi / Hindi / English). A photo of the delivered basket is checked against the order, and one-tap **Finished** buttons track stock during the week. When the vendor is late, the app prompts a polite reminder. The vendor only receives WhatsApp messages and installs nothing.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + TypeScript + Vite, Tailwind CSS, `vite-plugin-pwa` (injectManifest, custom service worker) |
| Data | Firestore with `persistentLocalCache` (offline-first; writes queue and sync) |
| Auth | Firebase Auth phone OTP (invisible reCAPTCHA) |
| Backend | Cloud Functions v2 (Node 20, TypeScript), Cloud Scheduler, FCM web push, App Check |
| Photos | Cloud Storage (7-day lifecycle) + `recogniseDelivery` (Claude vision via the Anthropic SDK, key in Functions secrets) |
| Messaging | `https://wa.me/<number>?text=…` deep links from the client |

## Layout

```
src/
  lib/firebase.ts        initializeApp from VITE_FIREBASE_*, Firestore persistent cache, Auth, Storage, Functions, Messaging, App Check
  lib/household.tsx      auth + household context, live collections, i18n `t()`
  lib/pantry.ts          pantry belief + run-out estimates (includes pending offline taps)
  lib/actions.ts         client writes, wa.me helpers, reminders, shortage notes
  lib/i18n.ts            UI copy in en / hi / mr
  sw.ts                  service worker: precache, offline fallback, FCM background messages
  pages/                 Home, Order, OrderCheck, Pantry, Catalogue, Vendors, History, Settings, More, Login, Setup, Join
functions/src/
  engine.ts              pure proposal engine (rules 1–9) + skip learning — unit tested
  proposeOrders.ts       hourly scheduler → draft orders the morning before delivery
  buildMessage.ts        callable on approve → numbered list in vendor language; runs skip learning
  checkLateDeliveries.ts every 15 min → FCM late prompts (first + second reminder)
  recogniseDelivery.ts   callable → vision check of basket photo, merged by max confidence
  confirmDelivery.ts     callable → stockEvents, lastReceivedAt, lateness, carry-overs, spend
  onStockEvent.ts        Firestore triggers: pantry belief, spoilage shelf-life learning, FCM topic sync, queue push
  joinHousehold.ts       createHousehold (copies seed catalogue) + joinHousehold (invite code)
  i18n/units.ts          local unit words (पाव, अर्धा किलो, जुडी, गड्डी, नग, डझन…) + message templates
  seed/seedItems.json    60 West-India vegetables, fruits and herbs (EN/HI/MR names, unit, qty, shelf life, season)
firestore.rules, storage.rules, firestore.indexes.json, storage-lifecycle.json, firebase.json
```

## Setup

1. Create a Firebase project (Blaze plan: Functions, Scheduler and the vision API call need it). Enable **Phone** sign-in, Firestore, Storage, Cloud Messaging and App Check with reCAPTCHA Enterprise.
2. Copy `.env.example` to `.env` and fill in the web app config, the Web Push VAPID key and the App Check site key.
3. Install:
   ```bash
   npm install
   npm --prefix functions install
   ```
4. Set the vision key as a Functions secret (never in the client):
   ```bash
   firebase functions:secrets:set ANTHROPIC_API_KEY
   ```
5. Deploy:
   ```bash
   npm run build
   firebase deploy
   ```
6. Apply the 7-day photo lifecycle rule to the bucket:
   ```bash
   gsutil lifecycle set storage-lifecycle.json gs://<your-bucket>
   ```
7. Optional: load the global `seedItems` and `seasonCalendar` collections (households fall back to the bundled JSON if empty):
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS=serviceAccount.json npm run seed
   ```

## Development

```bash
npm run dev                      # web app
npm --prefix functions test      # engine + message template unit tests
firebase emulators:start         # auth, firestore, functions, storage, hosting
```

Set `VITE_APPCHECK_DEBUG=true` locally to use an App Check debug token.

## Engine rules (Cloud Functions; the client only renders)

1. Carry-overs from the last delivery (`not_seen` / `short`) → `shortage_carry`
2. Spouse's "Add to next order" queue → `member_added`
3. Finished since last order → `finished`; half-left that will expire before the next delivery → 50% qty
4. Rotation: weekly always; biweekly ≥ 12 days; monthly ≥ 26 days; on-demand only via 1–3
5. Shelf-life suppression (received within 80% of shelf life, nothing finished) → `skipped` "still at home"
6. Season: out-of-season excluded unless pinned; up to 3 in-season items not ordered in 21 days → `season`, peak first
7. Skip learning on approve: removed from 3 drafts → demote rotation; on-demand added 3× in 6 weeks → biweekly
8. Quantity: `medianKeptQty` else `defaultQty`; festival week → banner
9. Sort: leafy → vegetable → root → herb → fruit → dairy
