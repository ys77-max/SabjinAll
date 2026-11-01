import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useHousehold } from '../lib/household';
import { callables } from '../lib/firebase';
import { addToOrder, queueForNextOrder, recordStock, sendReminder, unqueue } from '../lib/actions';
import { computeBeliefs, type Belief } from '../lib/pantry';
import { DAY_NAMES, localName } from '../lib/i18n';
import { dowOf, istMs, istTime, nextDeliveryDate, todayStr } from '../lib/dates';
import { useLongPress, useOnline } from '../lib/hooks';
import { ItemSearch, Sheet, toast } from '../components/ui';
import { CATEGORY_ORDER, type Item, type Order, type Vendor } from '../lib/types';

const ACTIVE = ['draft', 'approved', 'sent', 'reminded'];

export default function Home() {
  const { household, recentOrders, vendors, t } = useHousehold();
  const today = todayStr();
  const active = recentOrders
    .filter((o) => ACTIVE.includes(o.status) && o.forDate >= today)
    .sort((a, b) => a.forDate.localeCompare(b.forDate));
  const receivedToday = recentOrders.filter((o) => o.forDate === today && ['received', 'partially_received'].includes(o.status));

  return (
    <main className="page">
      <header className="mb-4 flex items-center gap-3">
        <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
        <div>
          <h1 className="text-2xl font-bold text-brand-800">{household?.name ?? 'SabziList'}</h1>
          <p className="text-sm text-gray-500">{t('today')} · {new Date().toLocaleDateString(household?.languagePref === 'en' ? 'en-IN' : `${household?.languagePref ?? 'mr'}-IN`, { weekday: 'long', day: 'numeric', month: 'short' })}</p>
        </div>
      </header>

      <section aria-label={t('today')} className="space-y-3">
        {active.map((o) => <TodayCard key={o.id} order={o} vendor={vendors.find((v) => v.id === o.vendorId)} />)}
        {active.length === 0 && receivedToday.map((o) => (
          <Link key={o.id} to={`/order/${o.id}`} className="card flex min-h-tap items-center justify-between bg-brand-50">
            <span className="text-lg font-semibold text-brand-800">{t('receivedToday')}</span>
            <span className="text-sm text-gray-600">{vendors.find((v) => v.id === o.vendorId)?.name}</span>
          </Link>
        ))}
        {active.length === 0 && <NoOrderCard vendors={vendors} />}
      </section>

      <FinishedGrid />
      <AddToNext activeDraft={active.find((o) => o.status === 'draft' || o.status === 'approved')} />
    </main>
  );
}

function TodayCard({ order, vendor }: { order: Order; vendor?: Vendor }) {
  const { householdId, user, lang, t } = useHousehold();
  const nav = useNavigate();
  const online = useOnline();
  const day = DAY_NAMES[lang][dowOf(order.forDate)];
  const time = vendor?.usualDeliveryTime ?? '10:00';
  const isToday = order.forDate === todayStr();
  const due = istMs(order.forDate, time);
  const lateAfter = due + (vendor?.reminderAfterMin ?? 60) * 60_000;
  const now = Date.now();

  if (order.status === 'draft' || order.status === 'approved') {
    return (
      <div className="card border-l-8 border-brand-600">
        <p className="text-lg font-semibold">{t('draftReady', { day })}</p>
        <p className="mb-3 text-sm text-gray-500">{vendor?.name}{order.status === 'approved' ? ` · ${t('approvedNotSent')}` : ''}</p>
        <button className="btn-primary w-full text-lg" onClick={() => nav(`/order/${order.id}`)}>{t('review')}</button>
      </div>
    );
  }

  const sentTime = order.sentAt ? istTime(order.sentAt.toMillis()) : '';
  const late = isToday && now > lateAfter;
  return (
    <div className={`card border-l-8 ${late ? 'border-amber-500' : 'border-brand-600'}`}>
      {late ? (
        <>
          <p className="text-lg font-semibold text-amber-800">{t('late', { vendor: vendor?.name ?? '' })}</p>
          <p className="mb-3 text-sm text-gray-500">
            {t('lateBy', { min: Math.round((now - due) / 60_000) })}
            {order.reminderCount ? ` · ${t('remindersSent', { n: order.reminderCount })}` : ''}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-secondary" disabled={!vendor || !online}
              onClick={() => vendor && sendReminder(householdId!, user!.uid, order, vendor)}>{t('sendReminder')}</button>
            <button className="btn-primary" onClick={() => nav(`/order/${order.id}/check`)}>{t('markReceived')}</button>
          </div>
        </>
      ) : isToday ? (
        <>
          <p className="text-lg font-semibold">{t('deliveryDue', { time })}</p>
          <p className="mb-3 text-sm text-gray-500">{vendor?.name} · {t('sentAt', { time: sentTime })}</p>
          <button className="btn-primary w-full text-lg" onClick={() => nav(`/order/${order.id}/check`)}>{t('markReceived')}</button>
        </>
      ) : (
        <Link to={`/order/${order.id}`} className="block">
          <p className="text-lg font-semibold">✓ {t('sentAt', { time: sentTime })}</p>
          <p className="text-sm text-gray-500">{vendor?.name} · {t('arrivesOn', { day, time })}</p>
        </Link>
      )}
    </div>
  );
}

function NoOrderCard({ vendors }: { vendors: Vendor[] }) {
  const { householdId, lang, t } = useHousehold();
  const nav = useNavigate();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const vendor = vendors.find((v) => v.isActive) ?? vendors[0];

  if (!vendor) {
    return (
      <div className="card text-center">
        <p className="mb-3 text-gray-600">{t('addVendorFirst')}</p>
        <Link to="/vendors" className="btn-primary w-full">{t('addVendor')}</Link>
      </div>
    );
  }
  const next = nextDeliveryDate(vendor.deliveryDays);
  async function makeNow() {
    setBusy(true);
    try {
      const res = await callables.generateDraftNow({ householdId: householdId!, vendorId: vendor.id });
      nav(`/order/${res.data.orderId}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card">
      <p className="text-lg font-semibold">{t('noOrder')}</p>
      {next && <p className="mb-3 text-sm text-gray-500">{t('nextListOn', { day: DAY_NAMES[lang][dowOf(next)] })}</p>}
      <button className="btn-secondary w-full" disabled={busy || !online} onClick={makeNow}>
        {busy ? '…' : online ? t('makeListNow') : t('needsNetwork')}
      </button>
    </div>
  );
}

function FinishedGrid() {
  const { items, stockEvents, householdId, user, lang, t } = useHousehold();
  const [sheetFor, setSheetFor] = useState<Item | null>(null);
  const atHome = useMemo(
    () =>
      computeBeliefs(items, stockEvents)
        .filter((b) => b.atHome)
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.item.category) - CATEGORY_ORDER.indexOf(b.item.category)),
    [items, stockEvents],
  );

  const mark = (item: Item, kind: 'finished' | 'half_left' | 'spoiled') => {
    recordStock(householdId!, user!.uid, item, kind);
    if (kind === 'finished') {
      toast(t('markedFinished', { item: localName(item, lang) }), {
        label: t('undo'),
        run: () => recordStock(householdId!, user!.uid, item, 'manual_set', 1),
      });
    }
  };

  return (
    <section className="mt-6" aria-labelledby="athome">
      <h2 id="athome" className="text-lg font-bold text-brand-800">{t('atHome')}</h2>
      <p className="mb-3 text-sm text-gray-500">{t('atHomeHint')}</p>
      {atHome.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-gray-300 p-5 text-center text-gray-500">{t('nothingAtHome')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {atHome.map((b) => (
            <FinishedChip key={b.item.id} belief={b} onTap={() => mark(b.item, 'finished')} onLong={() => setSheetFor(b.item)} />
          ))}
        </div>
      )}
      <Sheet open={!!sheetFor} onClose={() => setSheetFor(null)} title={sheetFor ? localName(sheetFor, lang) : ''}>
        {sheetFor && (
          <div className="grid gap-2">
            <button className="btn-secondary text-lg" onClick={() => { mark(sheetFor, 'half_left'); setSheetFor(null); }}>◐ {t('halfLeft')}</button>
            <button className="btn-danger text-lg" onClick={() => { mark(sheetFor, 'spoiled'); setSheetFor(null); }}>✕ {t('spoiled')}</button>
            <button className="btn-primary text-lg" onClick={() => { mark(sheetFor, 'finished'); setSheetFor(null); }}>✓ {t('finished')}</button>
          </div>
        )}
      </Sheet>
    </section>
  );
}

function FinishedChip({ belief, onTap, onLong }: { belief: Belief; onTap: () => void; onLong: () => void }) {
  const { lang } = useHousehold();
  const handlers = useLongPress(onTap, onLong);
  const half = belief.state === 'half';
  return (
    <button {...handlers}
      className={`relative flex min-h-[64px] select-none items-center justify-center rounded-2xl px-3 py-2 text-center text-lg font-semibold shadow-sm ring-1 active:scale-95 ${
        half ? 'bg-amber-50 text-amber-900 ring-amber-200' : 'bg-white text-gray-900 ring-black/5'
      }`}
      style={{ touchAction: 'manipulation', WebkitUserSelect: 'none' }}>
      {half && <span className="absolute right-2 top-1 text-xs" aria-hidden>◐</span>}
      {localName(belief.item, lang)}
    </button>
  );
}

function AddToNext({ activeDraft }: { activeDraft?: Order }) {
  const { items, queue, householdId, user, lang, t } = useHousehold();
  const pick = (item: Item) => {
    if (activeDraft) {
      addToOrder(householdId!, activeDraft.id, user!.uid, item, 'member_added');
      toast(t('addedToDraft'));
    } else {
      queueForNextOrder(householdId!, user!.uid, item);
    }
  };
  return (
    <section className="mt-6" aria-labelledby="addnext">
      <h2 id="addnext" className="mb-2 text-lg font-bold text-brand-800">{t('addToNext')}</h2>
      <ItemSearch placeholder={t('addToNextPh')} onPick={pick} exclude={queue.map((q) => q.id)} />
      {queue.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-sm text-gray-500">{t('queued')}</p>
          <div className="flex flex-wrap gap-2">
            {queue.map((q) => {
              const it = items.find((i) => i.id === q.id);
              return (
                <span key={q.id} className="chip bg-brand-100 pr-1 text-brand-800">
                  {it ? localName(it, lang) : q.id}
                  <button className="ml-1 h-8 w-8 rounded-full text-lg" aria-label={t('remove')} onClick={() => unqueue(householdId!, q.id)}>×</button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
