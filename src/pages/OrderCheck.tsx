import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { collection, doc, setDoc, Timestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage, callables } from '../lib/firebase';
import { useHousehold } from '../lib/household';
import { useDocument, useOnline, useQuery } from '../lib/hooks';
import { sendShortage } from '../lib/actions';
import { downscaleImage } from '../lib/image';
import { localName, unitLabel } from '../lib/i18n';
import { Header, ItemSearch, Stepper, stepFor, toast } from '../components/ui';
import { CATEGORY_ORDER, type Item, type Order, type OrderItem } from '../lib/types';

type RS = 'received' | 'not_seen' | 'unsure';
const NEXT: Record<RS, RS> = { received: 'not_seen', not_seen: 'unsure', unsure: 'received' };
const ICON: Record<RS | 'short', { glyph: string; cls: string }> = {
  received: { glyph: '✓', cls: 'bg-brand-600 text-white' },
  not_seen: { glyph: '⚠', cls: 'bg-amber-500 text-white' },
  unsure: { glyph: '?', cls: 'bg-gray-300 text-gray-800' },
  short: { glyph: '½', cls: 'bg-amber-200 text-amber-900' },
};

export default function OrderCheck() {
  const { id = '' } = useParams();
  const { householdId, items, vendors, user, lang, t } = useHousehold();
  const online = useOnline();
  const op = `households/${householdId}/orders/${id}`;
  const { data: order } = useDocument<Order>(householdId ? doc(db, op) : null, [op]);
  const { data: lines } = useQuery<OrderItem>(householdId ? collection(db, op, 'items') : null, [op]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const vendor = vendors.find((v) => v.id === order?.vendorId);

  const [statusOverride, setStatusOverride] = useState<Record<string, RS>>({});
  const [qtyOverride, setQtyOverride] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [recognising, setRecognising] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [extrasSeen, setExtrasSeen] = useState<{ label: string; confidence: number }[]>([]);
  const [extras, setExtras] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ shortItemIds: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!order) return <main className="page">{t('loading')}</main>;
  const done = ['received', 'partially_received'].includes(order.status) || !!result;

  const rows = lines
    .filter((l) => l.status !== 'removed' && itemById.has(l.id))
    .sort((a, b) => CATEGORY_ORDER.indexOf(itemById.get(a.id)!.category) - CATEGORY_ORDER.indexOf(itemById.get(b.id)!.category));

  const statusOf = (l: OrderItem): RS => {
    if (statusOverride[l.id]) return statusOverride[l.id];
    const rs = l.receivedStatus;
    return rs === 'not_seen' || rs === 'unsure' ? rs : 'received';
  };
  const qtyOf = (l: OrderItem) => qtyOverride[l.id] ?? l.receivedQty ?? l.qty;

  async function onPhoto(file: File) {
    if (!householdId || !order) return;
    setThumbs((t0) => [...t0, URL.createObjectURL(file)]);
    if (!online) { setFallback(true); return toast(t('photoFailed')); }
    setRecognising(true);
    try {
      const blob = await downscaleImage(file);
      const photoRef = doc(collection(db, op, 'photos'));
      const path = `households/${householdId}/orders/${order.id}/${photoRef.id}.jpg`;
      await uploadBytes(storageRef(storage, path), blob, { contentType: 'image/jpeg' });
      await setDoc(photoRef, {
        storagePath: path,
        takenAt: Timestamp.now(),
        expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
      });
      const { data } = await callables.recogniseDelivery({ householdId, orderId: order.id, photoId: photoRef.id });
      if (data.fallback) {
        setFallback(true);
        toast(t('photoFailed'));
      } else {
        setFallback(false);
        setStatusOverride({}); // fresh recognition wins over earlier taps
        setExtrasSeen(data.extras.filter((e) => e.confidence >= 0.5));
      }
    } catch {
      setFallback(true);
      toast(t('photoFailed'));
    } finally {
      setRecognising(false);
    }
  }

  async function confirm() {
    if (!order) return;
    setBusy(true);
    try {
      const { data } = await callables.confirmDelivery({
        householdId: householdId!,
        orderId: order.id,
        lines: rows.map((l) => ({
          itemId: l.id,
          receivedStatus: statusOf(l),
          receivedQty: statusOf(l) === 'not_seen' ? 0 : qtyOf(l),
          price: prices[l.id] ? Number(prices[l.id]) : null,
        })),
        extras: extras.map((i) => ({ itemId: i.id, qty: i.defaultQty, unit: i.defaultUnit })),
      });
      setResult({ shortItemIds: data.shortItemIds });
      toast(t('confirmed'));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const shortIds = result?.shortItemIds ?? lines.filter((l) => l.receivedStatus === 'not_seen' || l.receivedStatus === 'short').map((l) => l.id);
  const shortItems = shortIds.map((i) => itemById.get(i)).filter(Boolean) as Item[];

  const matchExtra = (label: string) => {
    const s = label.toLowerCase();
    return items.find((i) => i.nameEn.toLowerCase().includes(s) || s.includes(i.nameEn.toLowerCase().split(' ')[0]));
  };

  return (
    <main className="page">
      <Header back title={t('checkDelivery')} />

      {!done && (
        <section className="mb-4">
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
          <button className="btn-primary w-full py-4 text-lg" disabled={recognising} onClick={() => fileRef.current?.click()}>
            📷 {recognising ? t('recognising') : thumbs.length ? t('addPhoto') : t('takePhoto')}
          </button>
          {thumbs.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-x-auto">
              {thumbs.map((src) => <img key={src} src={src} alt="" className="h-20 w-20 flex-none rounded-xl object-cover" />)}
            </div>
          )}
          {fallback && <p className="mt-2 text-sm text-amber-800">{t('photoFailed')}</p>}
          <p className="mt-2 text-sm text-gray-500">{t('tapToFlip')}</p>
        </section>
      )}

      <ul className="space-y-2">
        {rows.map((l) => {
          const it = itemById.get(l.id)!;
          const rs = done ? (l.receivedStatus ?? 'received') : statusOf(l);
          const icon = ICON[rs as RS | 'short'] ?? ICON.received;
          return (
            <li key={l.id} className="flex items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-black/5">
              <button className={`grid h-12 w-12 flex-none place-items-center rounded-full text-xl font-bold ${icon.cls}`}
                disabled={done} aria-label={rs}
                onClick={() => setStatusOverride((s) => ({ ...s, [l.id]: NEXT[statusOf(l)] }))}>
                {icon.glyph}
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-semibold">{localName(it, lang)}</p>
                <p className="text-sm text-gray-500">
                  {l.qty} {unitLabel(lang, l.unit)}
                  {l.photoConfidence != null && ` · ${Math.round(l.photoConfidence * 100)}%`}
                </p>
              </div>
              {!done && rs !== 'not_seen' && (
                <div className="flex flex-col items-end gap-1">
                  <Stepper value={qtyOf(l)} step={stepFor(l.unit)} onChange={(v) => setQtyOverride((q) => ({ ...q, [l.id]: v }))} />
                  <input className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-right text-sm" inputMode="decimal"
                    placeholder={`${t('price')}`} value={prices[l.id] ?? ''} aria-label={`${t('price')} ${it.nameEn}`}
                    onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value.replace(/[^\d.]/g, '') }))} />
                </div>
              )}
              {done && <span className="tabular-nums text-gray-600">{l.receivedQty ?? '—'} {unitLabel(lang, l.unit)}</span>}
            </li>
          );
        })}
      </ul>

      {!done && (
        <section className="mt-5">
          <h2 className="mb-2 text-lg font-bold text-brand-800">{t('alsoReceived')}</h2>
          {extrasSeen.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {extrasSeen.map((e) => {
                const m = matchExtra(e.label);
                return (
                  <button key={e.label} className="chip min-h-tap bg-white ring-1 ring-gray-300" disabled={!m}
                    onClick={() => m && setExtras((x) => (x.some((i) => i.id === m.id) ? x : [...x, m]))}>
                    + {m ? localName(m, lang) : e.label}
                  </button>
                );
              })}
            </div>
          )}
          <ItemSearch placeholder={t('addToNextPh')} exclude={[...rows.map((r) => r.id), ...extras.map((e) => e.id)]}
            onPick={(i) => setExtras((x) => [...x, i])} />
          {extras.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {extras.map((i) => (
                <span key={i.id} className="chip bg-brand-100 pr-1 text-brand-800">
                  {localName(i, lang)}
                  <button className="ml-1 h-8 w-8" aria-label={t('remove')} onClick={() => setExtras((x) => x.filter((e) => e.id !== i.id))}>×</button>
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="bottom-bar">
        {!done ? (
          <button className="btn-primary w-full py-4 text-lg shadow-lg" disabled={busy || recognising || !online} onClick={confirm}>
            {busy ? '…' : online ? t('confirm') : t('needsNetwork')}
          </button>
        ) : shortItems.length > 0 && vendor ? (
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" disabled={!online}
              onClick={() => sendShortage(householdId!, user!.uid, order, vendor, shortItems)}>{t('sendShortage')}</button>
            <Link to="/home" className="btn-secondary">{t('navHome')}</Link>
          </div>
        ) : (
          <Link to="/home" className="btn-primary w-full py-4 text-lg">{t('navHome')}</Link>
        )}
      </div>
    </main>
  );
}
