import { useState } from 'react';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useHousehold } from '../lib/household';
import { catLabel, DAY_SHORT, DAY_NAMES, LANG_NAMES } from '../lib/i18n';
import { Empty, Header, Sheet, Toggle } from '../components/ui';
import { CATEGORY_ORDER, type Lang, type Vendor } from '../lib/types';

type Draft = Omit<Vendor, 'id'>;
const blank: Draft = {
  name: '', whatsappNumber: '', language: 'mr', categories: ['leafy', 'vegetable', 'root', 'herb', 'fruit'],
  deliveryDays: [0, 3], usualDeliveryTime: '10:00', reminderAfterMin: 60, secondReminderAfterMin: 180, notes: '', isActive: true,
};

export default function Vendors() {
  const { vendors, lang, t } = useHousehold();
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  return (
    <main className="page">
      <Header back title={t('vendorsTitle')}
        right={<button className="btn-primary px-4" onClick={() => setEditing({ id: null, draft: { ...blank } })}>+ {t('newVendor')}</button>} />
      {vendors.length === 0 && <Empty>{t('addVendorFirst')}</Empty>}
      <ul className="space-y-2">
        {vendors.map((v) => (
          <li key={v.id}>
            <button className={`w-full rounded-2xl bg-white p-4 text-left ring-1 ring-black/5 ${v.isActive ? '' : 'opacity-50'}`}
              onClick={() => { const { id, ...rest } = v; setEditing({ id, draft: { ...blank, ...rest } }); }}>
              <p className="text-lg font-semibold">{v.name}</p>
              <p className="text-sm text-gray-500">
                {v.whatsappNumber} · {LANG_NAMES[v.language]} · {v.deliveryDays.map((d) => DAY_NAMES[lang][d]).join(', ')} · {v.usualDeliveryTime}
              </p>
            </button>
          </li>
        ))}
      </ul>
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('edit') : t('newVendor')}>
        {editing && <VendorForm id={editing.id} initial={editing.draft} onDone={() => setEditing(null)} />}
      </Sheet>
    </main>
  );
}

function VendorForm({ id, initial, onDone }: { id: string | null; initial: Draft; onDone: () => void }) {
  const { householdId, lang, t } = useHousehold();
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const col = collection(db, `households/${householdId}/vendors`);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function save() {
    const clean = { ...d, whatsappNumber: d.whatsappNumber.replace(/[^\d+]/g, '') };
    if (id) await updateDoc(doc(col, id), clean);
    else await addDoc(col, clean);
    onDone();
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">{t('vendor')}</label>
        <input className="field" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="Ramesh bhaiya" />
      </div>
      <div>
        <label className="label">{t('whatsapp')}</label>
        <input className="field" inputMode="tel" value={d.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} placeholder="+91 98xxxxxxxx" />
      </div>
      <div>
        <span className="label">{t('vendorLanguage')}</span>
        <div className="flex gap-2">
          {(['mr', 'hi', 'en'] as Lang[]).map((l) => (
            <button key={l} onClick={() => set('language', l)}
              className={`chip min-h-tap px-4 ${d.language === l ? 'bg-brand-700 text-white' : 'bg-white ring-1 ring-gray-300'}`}>{LANG_NAMES[l]}</button>
          ))}
        </div>
      </div>
      <div>
        <span className="label">{t('deliveryDays')}</span>
        <div className="grid grid-cols-7 gap-1">
          {DAY_SHORT[lang].map((s, idx) => (
            <button key={idx} aria-label={DAY_NAMES[lang][idx]} aria-pressed={d.deliveryDays.includes(idx)}
              className={`min-h-tap rounded-xl font-semibold ${d.deliveryDays.includes(idx) ? 'bg-brand-600 text-white' : 'bg-gray-100'}`}
              onClick={() => set('deliveryDays', toggle(d.deliveryDays, idx).sort())}>{s}</button>
          ))}
        </div>
      </div>
      <div>
        <span className="label">{t('categories')}</span>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_ORDER.map((c) => (
            <button key={c} aria-pressed={d.categories.includes(c)}
              className={`chip min-h-tap ${d.categories.includes(c) ? 'bg-brand-600 text-white' : 'bg-gray-100'}`}
              onClick={() => set('categories', toggle(d.categories, c))}>{catLabel(lang, c)}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">{t('usualTime')}</label>
          <input className="field" type="time" value={d.usualDeliveryTime} onChange={(e) => set('usualDeliveryTime', e.target.value)} />
        </div>
        <div>
          <label className="label">{t('reminderAfter')}</label>
          <input className="field" type="number" inputMode="numeric" min={0} value={d.reminderAfterMin}
            onChange={(e) => set('reminderAfterMin', Number(e.target.value))} />
        </div>
        <div>
          <label className="label">{t('secondReminderAfter')}</label>
          <input className="field" type="number" inputMode="numeric" min={0} value={d.secondReminderAfterMin}
            onChange={(e) => set('secondReminderAfterMin', Number(e.target.value))} />
        </div>
      </div>
      <div>
        <label className="label">{t('notes')}</label>
        <textarea className="field py-2" rows={2} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <Toggle checked={d.isActive} onChange={(v) => set('isActive', v)} label={t('active')} />
      <button className="btn-primary w-full text-lg" disabled={!d.name.trim() || d.whatsappNumber.replace(/\D/g, '').length < 10 || !d.deliveryDays.length}
        onClick={save}>{t('save')}</button>
      {id && <button className="btn-danger w-full" onClick={async () => { await deleteDoc(doc(col, id)); onDone(); }}>{t('delete')}</button>}
    </div>
  );
}
