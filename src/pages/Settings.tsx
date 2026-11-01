import { useState } from 'react';
import { collection, deleteDoc, doc, getDocs, updateDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { useHousehold } from '../lib/household';
import { enablePush } from '../lib/push';
import { LANG_NAMES } from '../lib/i18n';
import { Header, Toggle, toast } from '../components/ui';
import type { Lang } from '../lib/types';

export default function Settings() {
  const { household, householdId, members, user, t, lang } = useHousehold();
  const me = members.find((m) => m.id === user?.uid);
  const isOwner = me?.role === 'owner';
  const hRef = householdId ? doc(db, 'households', householdId) : null;
  const [pushOn, setPushOn] = useState(typeof Notification !== 'undefined' && Notification.permission === 'granted');

  const patch = (data: Partial<{ name: string; city: string; languagePref: Lang; notifyDraftHour: number; notifyDeliveryDue: boolean }>) => hRef && isOwner && updateDoc(hRef, data);
  const inviteUrl = `${location.origin}/join/${household?.inviteCode}`;

  async function share() {
    const text = `SabziList: ${inviteUrl}`;
    if (navigator.share) await navigator.share({ title: 'SabziList', text, url: inviteUrl }).catch(() => undefined);
    else { await navigator.clipboard.writeText(text); toast(t('copied')); }
  }

  async function exportData() {
    const hp = `households/${householdId}`;
    const out: Record<string, unknown> = { household };
    for (const c of ['members', 'vendors', 'items', 'stockEvents', 'messages', 'nextOrderQueue']) {
      out[c] = (await getDocs(collection(db, hp, c))).docs.map((d) => ({ id: d.id, ...d.data() }));
    }
    const orders = await getDocs(collection(db, hp, 'orders'));
    out.orders = await Promise.all(orders.docs.map(async (o) => ({
      id: o.id, ...o.data(),
      items: (await getDocs(collection(db, hp, 'orders', o.id, 'items'))).docs.map((d) => ({ id: d.id, ...d.data() })),
    })));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `sabzilist-${new Date().toISOString().slice(0, 10)}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!household) return <main className="page">{t('loading')}</main>;

  return (
    <main className="page">
      <Header back title={t('settingsTitle')} />

      <section className="card mb-4 space-y-3">
        <div>
          <label className="label" htmlFor="hn">{t('householdName')}</label>
          <input id="hn" className="field" defaultValue={household.name} disabled={!isOwner} onBlur={(e) => patch({ name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="city">{t('city')}</label>
          <input id="city" className="field" defaultValue={household.city} disabled={!isOwner} onBlur={(e) => patch({ city: e.target.value })} />
        </div>
        <div>
          <span className="label">{t('language')}</span>
          <div className="flex gap-2">
            {(['mr', 'hi', 'en'] as Lang[]).map((l) => (
              <button key={l} disabled={!isOwner} onClick={() => patch({ languagePref: l })}
                className={`chip min-h-tap px-4 ${lang === l ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-gray-300'}`}>{LANG_NAMES[l]}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="card mb-4 space-y-3">
        <div>
          <label className="label" htmlFor="dh">{t('draftHour')}</label>
          <select id="dh" className="field" value={household.notifyDraftHour ?? 7} disabled={!isOwner}
            onChange={(e) => patch({ notifyDraftHour: Number(e.target.value) })}>
            {Array.from({ length: 17 }, (_, i) => i + 5).map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
        <Toggle checked={household.notifyDeliveryDue ?? true} onChange={(v) => patch({ notifyDeliveryDue: v })} label={t('deliveryDueNotify')} />
        <button className="btn-secondary w-full" disabled={pushOn}
          onClick={async () => setPushOn(await enablePush(householdId!, user!.uid).catch(() => false))}>
          {pushOn ? `✓ ${t('notificationsOn')}` : t('enableNotifications')}
        </button>
      </section>

      <section className="card mb-4">
        <h2 className="mb-2 text-lg font-bold">{t('members')}</h2>
        <ul className="mb-3 divide-y">
          {members.map((m) => (
            <li key={m.id} className="flex min-h-tap items-center justify-between">
              <span>{m.name} <span className="text-sm text-gray-500">{m.phone}{m.role === 'owner' ? ` · ${t('owner')}` : ''}</span></span>
              {isOwner && m.id !== user?.uid && (
                <button className="btn-ghost px-2 text-red-700" onClick={() => deleteDoc(doc(db, 'households', householdId!, 'members', m.id))}>{t('remove')}</button>
              )}
            </li>
          ))}
        </ul>
        <p className="label">{t('inviteCode')}</p>
        <div className="flex items-center gap-2">
          <span className="flex-1 font-mono text-2xl tracking-widest">{household.inviteCode}</span>
          <button className="btn-primary" onClick={share}>{t('shareInvite')}</button>
        </div>
      </section>

      <button className="btn-secondary mb-2 w-full" onClick={exportData}>{t('exportData')}</button>
      <button className="btn-ghost w-full text-red-700" onClick={() => signOut(auth)}>{t('signOut')}</button>
    </main>
  );
}
