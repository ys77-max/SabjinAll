import { useMemo, useState } from 'react';
import { useHousehold } from '../lib/household';
import { computeBeliefs, type Belief } from '../lib/pantry';
import { recordStock } from '../lib/actions';
import { DAY_NAMES, localName } from '../lib/i18n';
import { dayIndexFromMs, DAY_MS } from '../lib/dates';
import { Empty, Header, Sheet } from '../components/ui';
import { CATEGORY_ORDER, type Item } from '../lib/types';

export default function Pantry() {
  const { items, stockEvents, householdId, user, lang, t } = useHousehold();
  const [setFor, setSetFor] = useState<Item | null>(null);
  const beliefs = useMemo(
    () =>
      computeBeliefs(items, stockEvents)
        .filter((b) => b.atHome)
        .sort((a, b) => (a.runOutMs ?? Infinity) - (b.runOutMs ?? Infinity) ||
          CATEGORY_ORDER.indexOf(a.item.category) - CATEGORY_ORDER.indexOf(b.item.category)),
    [items, stockEvents],
  );

  const runOut = (b: Belief) => {
    if (!b.runOutMs) return '';
    if (b.runOutMs - Date.now() < DAY_MS) return t('runOutToday');
    return t('runsOut', { day: DAY_NAMES[lang][dayIndexFromMs(b.runOutMs)] });
  };
  const act = (item: Item, kind: 'finished' | 'half_left' | 'spoiled') => recordStock(householdId!, user!.uid, item, kind);

  return (
    <main className="page">
      <Header title={t('pantryTitle')} />
      {beliefs.length === 0 && <Empty>{t('nothingAtHome')}</Empty>}
      <ul className="space-y-2">
        {beliefs.map((b) => {
          const soon = b.runOutMs !== null && b.runOutMs - Date.now() < DAY_MS;
          return (
            <li key={b.item.id} className="rounded-2xl bg-white p-3 ring-1 ring-black/5">
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <p className="text-lg font-semibold">
                  {localName(b.item, lang)} {b.state === 'half' && <span className="text-amber-700">◐</span>}
                </p>
                <span className={`text-sm ${soon ? 'font-semibold text-red-700' : 'text-gray-500'}`}>{runOut(b)}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                <button className="btn-secondary px-1 text-sm" onClick={() => act(b.item, 'finished')}>{t('finished')}</button>
                <button className="btn-secondary px-1 text-sm" onClick={() => act(b.item, 'half_left')}>{t('halfLeft')}</button>
                <button className="btn-secondary px-1 text-sm text-red-700" onClick={() => act(b.item, 'spoiled')}>{t('spoiled')}</button>
                <button className="btn-ghost px-1 text-sm" onClick={() => setSetFor(b.item)}>{t('set')}…</button>
              </div>
            </li>
          );
        })}
      </ul>

      <Sheet open={!!setFor} onClose={() => setSetFor(null)} title={setFor ? localName(setFor, lang) : ''}>
        {setFor && (
          <div className="grid grid-cols-3 gap-2">
            {([[1, 'full'], [0.5, 'halfLeft'], [0, 'none']] as const).map(([q, k]) => (
              <button key={k} className="btn-secondary py-4 text-lg"
                onClick={() => { recordStock(householdId!, user!.uid, setFor, 'manual_set', q); setSetFor(null); }}>
                {t(k)}
              </button>
            ))}
          </div>
        )}
      </Sheet>
    </main>
  );
}
