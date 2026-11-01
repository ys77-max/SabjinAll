import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHousehold } from '../lib/household';
import { useOnline } from '../lib/hooks';
import { searchItems } from '../lib/actions';
import { localName } from '../lib/i18n';
import type { Item } from '../lib/types';

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useHousehold();
  if (online) return null;
  return (
    <div className="sticky top-0 z-40 bg-amber-100 px-4 py-2 text-center text-sm font-medium text-amber-900" role="status">
      {t('offline')}
    </div>
  );
}

export function Header({ title, back, right }: { title: ReactNode; back?: boolean; right?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="mb-4 flex min-h-tap items-center gap-2">
      {back && (
        <button className="btn-ghost -ml-3 px-3" onClick={() => nav(-1)} aria-label="Back">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="m15 18-6-6 6-6" /></svg>
        </button>
      )}
      <h1 className="flex-1 text-2xl font-bold text-brand-800">{title}</h1>
      {right}
    </header>
  );
}

export function Stepper({ value, onChange, step = 1, min = 0 }: { value: number; onChange: (v: number) => void; step?: number; min?: number }) {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ''));
  return (
    <div className="flex items-center rounded-2xl bg-brand-50">
      <button className="h-12 w-12 text-2xl font-semibold text-brand-800 disabled:opacity-30" disabled={value - step < min}
        onClick={() => onChange(Math.max(min, +(value - step).toFixed(3)))} aria-label="Decrease">−</button>
      <span className="min-w-[2.5rem] text-center text-lg font-semibold tabular-nums">{fmt(value)}</span>
      <button className="h-12 w-12 text-2xl font-semibold text-brand-800" onClick={() => onChange(+(value + step).toFixed(3))} aria-label="Increase">+</button>
    </div>
  );
}

export const stepFor = (unit: string) => (unit === 'g' ? 250 : unit === 'kg' ? 0.5 : 1);

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose} role="dialog" aria-modal>
      <div
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4"
        style={{ paddingBottom: 'calc(16px + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-300" />
        {title && <h2 className="mb-3 text-xl font-bold">{title}</h2>}
        {children}
      </div>
    </div>
  );
}

let toastSetter: ((t: { text: string; action?: { label: string; run: () => void } } | null) => void) | null = null;
export function toast(text: string, action?: { label: string; run: () => void }) {
  toastSetter?.({ text, action });
}
export function ToastHost() {
  const [msg, setMsg] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  useEffect(() => {
    toastSetter = setMsg;
    return () => { toastSetter = null; };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setMsg(null), 4000);
    return () => window.clearTimeout(id);
  }, [msg]);
  if (!msg) return null;
  return (
    <div className="fixed inset-x-0 z-50 mx-auto flex max-w-lg px-4" style={{ bottom: 'calc(80px + env(safe-area-inset-bottom))' }}>
      <div className="flex w-full items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 text-white shadow-lg" role="status">
        <span className="flex-1">{msg.text}</span>
        {msg.action && (
          <button className="min-h-tap px-2 font-semibold text-brand-200" onClick={() => { msg.action!.run(); setMsg(null); }}>
            {msg.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** Autocomplete over the catalogue (EN/HI/MR names). */
export function ItemSearch({ placeholder, onPick, exclude = [] }: { placeholder: string; onPick: (item: Item) => void; exclude?: string[] }) {
  const { items, lang } = useHousehold();
  const [q, setQ] = useState('');
  const results = searchItems(items, q).filter((i) => !exclude.includes(i.id));
  return (
    <div className="relative">
      <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} enterKeyHint="search"
        autoComplete="off" aria-label={placeholder} />
      {results.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-black/10">
          {results.map((it) => (
            <li key={it.id}>
              <button className="flex min-h-tap w-full items-center justify-between px-4 text-left active:bg-brand-50"
                onClick={() => { onPick(it); setQ(''); }}>
                <span className="font-medium">{localName(it, lang)}</span>
                <span className="text-sm text-gray-500">{lang === 'en' ? it.nameMr : it.nameEn}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-3xl border border-dashed border-gray-300 p-6 text-center text-gray-500">{children}</p>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex min-h-tap items-center justify-between gap-3">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={`relative h-8 w-14 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-gray-300'}`}>
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${checked ? 'left-7' : 'left-1'}`} />
      </button>
    </label>
  );
}
