import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { collection, doc, updateDoc } from 'firebase/firestore';
import { db, callables } from '../lib/firebase';
import { useHousehold } from '../lib/household';
import { useDocument, useOnline, useQuery } from '../lib/hooks';
import {
  addToOrder, cancelOrder, logMessage, markSent, openWhatsApp, sendReminder, updateOrderItem,
} from '../lib/actions';
import { catLabel, DAY_NAMES, localName, reasonLabel, rotLabel, statusLabel, unitLabel } from '../lib/i18n';
import { dowOf, istMs } from '../lib/dates';
import { Header, ItemSearch, Sheet, Stepper, stepFor, toast } from '../components/ui';
import { CATEGORY_ORDER, UNITS, type Item, type Order, type OrderItem, type Unit } from '../lib/types';

const EDITABLE = ['draft', 'approved'];

export default function OrderPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const { householdId, items, vendors, members, user, lang, t } = useHousehold();
  const nav = useNavigate();
  const online = useOnline();
  const op = `households/${householdId}/orders/${id}`;
  const { data: order, loading } = useDocument<Order>(householdId ? doc(db, op) : null, [op]);
  const { data: lines } = useQuery<OrderItem>(householdId ? collection(db, op, 'items') : null, [op]);
  const [showRemoved, setShowRemoved] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const vendor = vendors.find((v) => v.id === order?.vendorId);

  if (loading && !order) return <main className="page">{t('loading')}</main>;
  if (!order) return <main className="page"><Header back title={t('error')} /></main>;

  const editable = EDITABLE.includes(order.status);
  const active = lines.filter((l) => l.status !== 'removed' && itemById.has(l.id));
  const removed = lines.filter((l) => l.status === 'removed' && itemById.has(l.id));
  const skipped = (order.skipped ?? []).filter((s) => itemById.has(s.itemId) && !active.some((l) => l.id === s.itemId));
  const day = DAY_NAMES[lang][dowOf(order.forDate)];
  const isLate =
    ['sent', 'reminded'].includes(order.status) && vendor &&
    Date.now() > istMs(order.forDate, vendor.usualDeliveryTime) + vendor.reminderAfterMin * 60_000;

  const who = (uid: string | null) => members.find((m) => m.id === uid)?.name ?? '';

  async function approveAndSend() {
    if (!order || !vendor) return;
    if (!online) return toast(t('needsNetwork'));
    if (!active.length) return toast(t('emptyList'));
    setBusy(true);
    try {
      const { data } = await callables.buildMessage({ householdId: householdId!, orderId: order.id });
      await markSent(householdId!, order);
      await logMessage(householdId!, user!.uid, order, 'order', data.text, vendor.language);
      openWhatsApp(data.whatsappNumber, data.text);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (!order || !vendor) return;
    setBusy(true);
    try {
      const { data } = await callables.buildMessage({ householdId: householdId!, orderId: order.id });
      await logMessage(householdId!, user!.uid, order, 'order', data.text, vendor.language);
      openWhatsApp(data.whatsappNumber, data.text);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addPicked(item: Item, rotation: boolean) {
    const existing = lines.find((l) => l.id === item.id);
    if (existing) updateOrderItem(householdId!, order!.id, item.id, { status: 'kept' });
    else addToOrder(householdId!, order!.id, user!.uid, item);
    if (rotation && item.rotation === 'on_demand') {
      updateDoc(doc(db, `households/${householdId}/items/${item.id}`), { rotation: 'weekly' });
    }
    setPendingAdd(null);
  }

  return (
    <main className="page">
      <Header back title={t('listFor', { day })}
        right={<span className="chip bg-brand-100 text-brand-800">{statusLabel(lang, order.status)}</span>} />
      <p className="-mt-3 mb-4 text-sm text-gray-500">{order.forDate} · {vendor?.name}</p>

      {order.festivalBanner && (
        <p className="mb-3 rounded-2xl bg-amber-50 p-3 text-amber-900">🪔 {t('festivalWeek', { name: order.festivalBanner })}</p>
      )}
      {order.notices?.map((n) => {
        const it = itemById.get(n.itemId);
        const to = n.code.split('->')[1] as Item['rotation'];
        if (!it || !to) return null;
        return (
          <p key={n.itemId} className="mb-2 rounded-2xl bg-sky-50 p-3 text-sm text-sky-900">
            {t(n.code.startsWith('demoted') ? 'noticeDemoted' : 'noticePromoted', { item: localName(it, lang), to: rotLabel(lang, to) })}
          </p>
        );
      })}

      {/* Grouped list */}
      {CATEGORY_ORDER.map((cat) => {
        const rows = active.filter((l) => itemById.get(l.id)!.category === cat);
        if (!rows.length) return null;
        return (
          <section key={cat} className="mb-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{catLabel(lang, cat)}</h2>
            <ul className="space-y-2">
              {rows.map((l) => (
                <OrderRow key={l.id} line={l} item={itemById.get(l.id)!} editable={editable}
                  peak={order.peakItemIds?.includes(l.id) ?? false} who={who(l.addedByUid)}
                  vendorLang={vendor?.language ?? 'hi'}
                  onRemove={() => {
                    updateOrderItem(householdId!, order.id, l.id, { status: 'removed' });
                    toast(localName(itemById.get(l.id)!, lang) + ' – ' + t('removed'), {
                      label: t('undo'),
                      run: () => updateOrderItem(householdId!, order.id, l.id, { status: l.status }),
                    });
                  }} />
              ))}
            </ul>
          </section>
        );
      })}

      {editable && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{t('addItem')}</h2>
          <ItemSearch placeholder={t('addToNextPh')} onPick={setPendingAdd} exclude={active.map((l) => l.id)} />
        </section>
      )}

      {skipped.length > 0 && (
        <section className="mb-3">
          <button className="btn-ghost w-full justify-between px-1" onClick={() => setShowSkipped((s) => !s)} aria-expanded={showSkipped}>
            <span>{t('skippedStillHome', { n: skipped.length })}</span><span>{showSkipped ? '▴' : '▾'}</span>
          </button>
          {showSkipped && (
            <ul className="space-y-1">
              {skipped.map((s) => {
                const it = itemById.get(s.itemId)!;
                return (
                  <li key={s.itemId} className="flex min-h-tap items-center justify-between rounded-2xl bg-white px-4 ring-1 ring-black/5">
                    <span>{localName(it, lang)} <span className="text-sm text-gray-500">· {t('receivedDaysAgo', { n: s.receivedDaysAgo ?? 0 })}</span></span>
                    {editable && <button className="btn-ghost px-2" onClick={() => addPicked(it, false)}>+ {t('addBack')}</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {removed.length > 0 && editable && (
        <section className="mb-3">
          <button className="btn-ghost w-full justify-between px-1" onClick={() => setShowRemoved((s) => !s)} aria-expanded={showRemoved}>
            <span>{t('removed')} ({removed.length})</span><span>{showRemoved ? '▴' : '▾'}</span>
          </button>
          {showRemoved && (
            <ul className="space-y-1">
              {removed.map((l) => (
                <li key={l.id} className="flex min-h-tap items-center justify-between rounded-2xl bg-white px-4 text-gray-500 line-through ring-1 ring-black/5">
                  {localName(itemById.get(l.id)!, lang)}
                  <button className="btn-ghost px-2 no-underline" style={{ textDecoration: 'none' }}
                    onClick={() => updateOrderItem(householdId!, order.id, l.id, { status: l.reason === 'manual' ? 'added' : 'kept' })}>
                    {t('restore')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!editable && order.messageText && (
        <MessagePanel text={order.messageText} vendorName={vendor?.name ?? ''} canResend={['sent', 'reminded'].includes(order.status)}
          busy={busy} onResend={resend} />
      )}

      {editable && (
        <button className="btn-ghost mt-4 w-full text-red-700" onClick={() => { cancelOrder(householdId!, order.id); nav('/home'); }}>
          {t('cancelOrder')}
        </button>
      )}

      {/* Bottom-anchored primary action */}
      <div className="bottom-bar">
        {editable ? (
          <button className="btn-primary w-full py-4 text-lg shadow-lg" disabled={busy || !vendor} onClick={approveAndSend}>
            {busy ? t('sending') : online ? `${t('approveSend')} · ${active.length}` : t('needsNetwork')}
          </button>
        ) : ['sent', 'reminded'].includes(order.status) ? (
          <div className="grid grid-cols-2 gap-2">
            <button className={isLate || params.get('remind') ? 'btn-primary' : 'btn-secondary'} disabled={!vendor || !online}
              onClick={() => vendor && sendReminder(householdId!, user!.uid, order, vendor)}>{t('sendReminder')}</button>
            <Link to={`/order/${order.id}/check`} className={isLate || params.get('remind') ? 'btn-secondary' : 'btn-primary'}>
              {t('markReceived')}
            </Link>
          </div>
        ) : ['received', 'partially_received'].includes(order.status) ? (
          <Link to={`/order/${order.id}/check`} className="btn-secondary w-full">{t('checkDelivery')}</Link>
        ) : null}
      </div>

      <Sheet open={!!pendingAdd} onClose={() => setPendingAdd(null)} title={pendingAdd ? localName(pendingAdd, lang) : ''}>
        {pendingAdd && (
          <div className="grid gap-2">
            <button className="btn-primary text-lg" onClick={() => addPicked(pendingAdd, false)}>{t('once')}</button>
            <button className="btn-secondary text-lg" onClick={() => addPicked(pendingAdd, true)}>{t('addToRotation')}</button>
          </div>
        )}
      </Sheet>
    </main>
  );
}

function OrderRow({ line, item, editable, peak, who, vendorLang, onRemove }: {
  line: OrderItem; item: Item; editable: boolean; peak: boolean; who: string; vendorLang: 'en' | 'hi' | 'mr'; onRemove: () => void;
}) {
  const { householdId, lang, t } = useHousehold();
  const { id: orderId = '' } = useParams();
  const startX = useRef<number | null>(null);
  const [dx, setDx] = useState(0);

  const setQty = (qty: number) => updateOrderItem(householdId!, orderId, line.id, { qty });
  const cycleUnit = () => {
    const next = UNITS[(UNITS.indexOf(line.unit) + 1) % UNITS.length] as Unit;
    const qty = next === 'g' ? 250 : line.unit === 'g' ? 1 : line.qty;
    updateOrderItem(householdId!, orderId, line.id, { unit: next, qty });
  };

  return (
    <li
      className="relative overflow-hidden rounded-2xl bg-red-500"
      onTouchStart={(e) => editable && (startX.current = e.touches[0].clientX)}
      onTouchMove={(e) => startX.current !== null && setDx(Math.min(0, e.touches[0].clientX - startX.current))}
      onTouchEnd={() => { if (dx < -100) onRemove(); setDx(0); startX.current = null; }}
    >
      <span className="absolute inset-y-0 right-4 flex items-center font-semibold text-white" aria-hidden>{t('remove')}</span>
      <div className="relative flex items-center gap-2 bg-white p-3 ring-1 ring-black/5 transition-transform"
        style={{ transform: `translateX(${dx}px)`, transition: dx ? 'none' : undefined }}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{localName(item, lang)}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {vendorLang !== lang && <span className="text-sm text-gray-500">{localName(item, vendorLang)}</span>}
            <span className={`chip min-h-[24px] px-2 text-xs ${line.reason === 'shortage_carry' ? 'bg-amber-100 text-amber-900' : line.reason === 'finished' ? 'bg-rose-100 text-rose-900' : line.reason === 'season' ? 'bg-lime-100 text-lime-900' : 'bg-gray-100 text-gray-700'}`}>
              {reasonLabel(lang, line.reason, who)}
            </span>
            {peak && <span className="chip min-h-[24px] bg-lime-100 px-2 text-xs text-lime-900">★ {t('peak')}</span>}
          </div>
        </div>
        {editable ? (
          <>
            <button className="chip min-h-tap bg-brand-50 px-3 font-medium text-brand-800" onClick={cycleUnit} aria-label={t('unit')}>
              {unitLabel(lang, line.unit)}
            </button>
            <Stepper value={line.qty} onChange={setQty} step={stepFor(line.unit)} min={stepFor(line.unit)} />
            <button className="h-12 w-10 text-2xl text-gray-400" aria-label={t('remove')} onClick={onRemove}>×</button>
          </>
        ) : (
          <span className="text-lg font-semibold tabular-nums">{line.qty} {unitLabel(lang, line.unit)}</span>
        )}
      </div>
    </li>
  );
}

function MessagePanel({ text, vendorName, canResend, busy, onResend }: { text: string; vendorName: string; canResend: boolean; busy: boolean; onResend: () => void }) {
  const { t } = useHousehold();
  const [copied, setCopied] = useState(false);
  return (
    <section className="card mt-2">
      <p className="mb-2 text-sm font-medium text-brand-800">✓ {t('messageSent', { vendor: vendorName })}</p>
      <pre className="mb-3 whitespace-pre-wrap rounded-2xl bg-[#e7f8dc] p-3 font-sans text-[15px] leading-relaxed">{text}</pre>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-secondary" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); }}>
          {copied ? t('copied') : t('copy')}
        </button>
        <button className="btn-secondary" disabled={!canResend || busy} onClick={onResend}>{t('resend')}</button>
      </div>
    </section>
  );
}
