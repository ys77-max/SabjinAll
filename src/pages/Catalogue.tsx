import { useMemo, useState } from 'react';
import { collection, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useHousehold } from '../lib/household';
import { catLabel, localName, MONTHS_SHORT, rotLabel, unitLabel } from '../lib/i18n';
import { Header, Sheet, Toggle } from '../components/ui';
import { CATEGORY_ORDER, ROTATIONS, UNITS, type Category, type Item } from '../lib/types';

type Draft = Pick<Item, 'nameEn' | 'nameHi' | 'nameMr' | 'category' | 'defaultUnit' | 'defaultQty' | 'shelfLifeDays' |
  'seasonMonths' | 'rotation' | 'isPinned' | 'isHidden' | 'vendorId'>;

const blank: Draft = {
  nameEn: '', nameHi: '', nameMr: '', category: 'vegetable', defaultUnit: 'kg', defaultQty: 1, shelfLifeDays: 5,
  seasonMonths: [], rotation: 'on_demand', isPinned: false, isHidden: false, vendorId: null,
};

export default function Catalogue() {
  const { items, lang, t } = useHousehold();
  const [q, setQ] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items
      .filter((i) => showHidden || !i.isHidden)
      .filter((i) => !s || [i.nameEn, i.nameHi, i.nameMr].some((n) => n?.toLowerCase().includes(s)))
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.nameEn.localeCompare(b.nameEn));
  }, [items, q, showHidden]);

  return (
    <main className="page">
      <Header back title={t('catalogueTitle')}
        right={<button className="btn-primary px-4" onClick={() => setEditing({ id: null, draft: { ...blank } })}>+ {t('newItem')}</button>} />
      <input className="field mb-2" placeholder={t('search')} value={q} onChange={(e) => setQ(e.target.value)} />
      <Toggle checked={showHidden} onChange={setShowHidden} label={t('hidden')} />

      {CATEGORY_ORDER.map((cat) => {
        const rows = filtered.filter((i) => i.category === cat);
        if (!rows.length) return null;
        return (
          <section key={cat} className="mt-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">{catLabel(lang, cat)}</h2>
            <ul className="space-y-1.5">
              {rows.map((i) => (
                <li key={i.id}>
                  <button className={`flex min-h-tap w-full items-center gap-3 rounded-2xl bg-white px-4 py-2 text-left ring-1 ring-black/5 ${i.isHidden ? 'opacity-50' : ''}`}
                    onClick={() => setEditing({ id: i.id, draft: pick(i) })}>
                    <div className="flex-1">
                      <p className="font-semibold">{i.isPinned && '📌 '}{localName(i, lang)}</p>
                      <p className="text-xs text-gray-500">{i.nameEn} · {i.nameHi} · {i.nameMr}</p>
                    </div>
                    <div className="text-right text-xs text-gray-500">
                      <p>{i.defaultQty} {unitLabel(lang, i.defaultUnit)} · {rotLabel(lang, i.rotation)}</p>
                      <p>{i.shelfLifeDays}d{i.seasonMonths.length ? ` · ${MONTHS_SHORT[lang][i.seasonMonths[0] - 1]}–${MONTHS_SHORT[lang][i.seasonMonths[i.seasonMonths.length - 1] - 1]}` : ''}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? t('edit') : t('newItem')}>
        {editing && <ItemForm id={editing.id} initial={editing.draft} onDone={() => setEditing(null)} />}
      </Sheet>
    </main>
  );
}

const pick = (i: Item): Draft => ({
  nameEn: i.nameEn, nameHi: i.nameHi, nameMr: i.nameMr, category: i.category, defaultUnit: i.defaultUnit,
  defaultQty: i.defaultQty, shelfLifeDays: i.shelfLifeDays, seasonMonths: i.seasonMonths ?? [], rotation: i.rotation,
  isPinned: i.isPinned, isHidden: i.isHidden, vendorId: i.vendorId ?? null,
});

function ItemForm({ id, initial, onDone }: { id: string | null; initial: Draft; onDone: () => void }) {
  const { householdId, vendors, lang, t } = useHousehold();
  const [d, setD] = useState<Draft>(initial);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  async function save() {
    const col = collection(db, `households/${householdId}/items`);
    if (id) {
      await updateDoc(doc(col, id), { ...d });
    } else {
      const slug = d.nameEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || doc(col).id;
      await setDoc(doc(col, `${slug}-${Date.now().toString(36).slice(-4)}`), {
        ...d, lastReceivedAt: null, lastFinishedAt: null, stockState: 'unknown', skipStreak: 0, addStreak: 0, peakMonths: [], createdAt: serverTimestamp(),
      });
    }
    onDone();
  }

  return (
    <div className="space-y-3">
      {(['nameEn', 'nameHi', 'nameMr'] as const).map((k) => (
        <div key={k}>
          <label className="label">{t(k)}</label>
          <input className="field" value={d[k]} onChange={(e) => set(k, e.target.value)} lang={k === 'nameEn' ? 'en' : k === 'nameHi' ? 'hi' : 'mr'} />
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">{t('category')}</label>
          <select className="field" value={d.category} onChange={(e) => set('category', e.target.value as Category)}>
            {CATEGORY_ORDER.map((c) => <option key={c} value={c}>{catLabel(lang, c)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('rotation')}</label>
          <select className="field" value={d.rotation} onChange={(e) => set('rotation', e.target.value as Draft['rotation'])}>
            {ROTATIONS.map((r) => <option key={r} value={r}>{rotLabel(lang, r)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('defaultQty')}</label>
          <input className="field" type="number" inputMode="decimal" min={0} step="any" value={d.defaultQty}
            onChange={(e) => set('defaultQty', Number(e.target.value))} />
        </div>
        <div>
          <label className="label">{t('unit')}</label>
          <select className="field" value={d.defaultUnit} onChange={(e) => set('defaultUnit', e.target.value as Draft['defaultUnit'])}>
            {UNITS.map((u) => <option key={u} value={u}>{unitLabel(lang, u)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">{t('shelfLife')}</label>
          <input className="field" type="number" inputMode="numeric" min={1} value={d.shelfLifeDays}
            onChange={(e) => set('shelfLifeDays', Math.max(1, Number(e.target.value)))} />
        </div>
        <div>
          <label className="label">{t('vendor')}</label>
          <select className="field" value={d.vendorId ?? ''} onChange={(e) => set('vendorId', e.target.value || null)}>
            <option value="">{t('anyVendor')}</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <span className="label">{t('seasonMonths')}</span>
        <div className="grid grid-cols-6 gap-1">
          {MONTHS_SHORT[lang].map((m, idx) => {
            const on = d.seasonMonths.includes(idx + 1);
            return (
              <button key={m} className={`min-h-tap rounded-xl text-sm ${on ? 'bg-brand-600 text-white' : 'bg-gray-100'}`}
                onClick={() => set('seasonMonths', on ? d.seasonMonths.filter((x) => x !== idx + 1) : [...d.seasonMonths, idx + 1].sort((a, b) => a - b))}>
                {m}
              </button>
            );
          })}
        </div>
      </div>
      <Toggle checked={d.isPinned} onChange={(v) => set('isPinned', v)} label={`📌 ${t('pin')}`} />
      <Toggle checked={d.isHidden} onChange={(v) => set('isHidden', v)} label={t('hide')} />
      <button className="btn-primary w-full text-lg" disabled={!d.nameEn.trim() || !(d.defaultQty > 0)} onClick={save}>{t('save')}</button>
    </div>
  );
}
