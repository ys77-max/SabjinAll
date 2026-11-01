import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useHousehold } from '../lib/household';
import { useQuery } from '../lib/hooks';
import { DAY_NAMES, statusLabel } from '../lib/i18n';
import { dowOf } from '../lib/dates';
import { Empty, Header } from '../components/ui';
import type { Order } from '../lib/types';

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-sky-100 text-sky-900', approved: 'bg-sky-100 text-sky-900', sent: 'bg-brand-100 text-brand-800',
  reminded: 'bg-amber-100 text-amber-900', received: 'bg-brand-600 text-white', partially_received: 'bg-amber-200 text-amber-900',
  cancelled: 'bg-gray-200 text-gray-600',
};

export default function History() {
  const { householdId, vendors, lang, t } = useHousehold();
  const hp = `households/${householdId}`;
  const { data: orders, loading } = useQuery<Order>(
    householdId ? query(collection(db, hp, 'orders'), orderBy('forDate', 'desc'), limit(60)) : null, [hp],
  );
  const [shorts, setShorts] = useState<Record<string, number>>({});

  // Count shortages per delivered order (cached reads work offline).
  useEffect(() => {
    let alive = true;
    const delivered = orders.filter((o) => ['received', 'partially_received'].includes(o.status));
    Promise.all(
      delivered.map(async (o) => {
        const snap = await getDocs(collection(db, hp, 'orders', o.id, 'items'));
        return [o.id, snap.docs.filter((d) => ['not_seen', 'short'].includes(d.get('receivedStatus'))).length] as const;
      }),
    ).then((pairs) => alive && setShorts(Object.fromEntries(pairs))).catch(() => undefined);
    return () => { alive = false; };
  }, [orders, hp]);

  return (
    <main className="page">
      <Header title={t('historyTitle')} />
      {!loading && orders.length === 0 && <Empty>{t('noOrders')}</Empty>}
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            <Link to={`/order/${o.id}`} className="flex min-h-tap items-center gap-3 rounded-2xl bg-white p-3 ring-1 ring-black/5">
              <div className="flex-1">
                <p className="font-semibold">{DAY_NAMES[lang][dowOf(o.forDate)]} · {o.forDate}</p>
                <p className="text-sm text-gray-500">
                  {vendors.find((v) => v.id === o.vendorId)?.name}
                  {o.latenessMin != null && ` · ${o.latenessMin > 15 ? t('lateness', { min: o.latenessMin }) : t('onTime')}`}
                  {shorts[o.id] ? ` · ${t('shortages', { n: shorts[o.id] })}` : ''}
                  {o.totalSpend != null && ` · ${t('spend', { n: o.totalSpend })}`}
                </p>
              </div>
              <span className={`chip ${STATUS_CLS[o.status] ?? ''}`}>{statusLabel(lang, o.status)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
