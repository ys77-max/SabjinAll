import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, query, where, orderBy, limit } from 'firebase/firestore';
import { auth, db } from './firebase';
import { useDocument, useQuery } from './hooks';
import { translate, type TKey } from './i18n';
import type { Household, Item, Lang, Member, Order, QueueEntry, StockEvent, Vendor } from './types';
import { addDaysStr, todayStr } from './dates';

interface Ctx {
  user: User | null;
  authReady: boolean;
  householdId: string | null;
  householdReady: boolean;
  household: Household | null;
  members: Member[];
  vendors: Vendor[];
  items: Item[];
  recentOrders: Order[];
  stockEvents: StockEvent[];
  queue: QueueEntry[];
  lang: Lang;
  setLocalLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}

const HouseholdContext = createContext<Ctx | null>(null);
const LANG_KEY = 'sabzilist.lang';

function readLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'en' || v === 'hi' || v === 'mr') return v;
  } catch {
    /* storage blocked */
  }
  return 'mr';
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [localLang, setLocalLangState] = useState<Lang>(readLang);

  useEffect(() => onAuthStateChanged(auth, (u) => { setUser(u); setAuthReady(true); }), []);

  const userDoc = useDocument<{ id: string; householdId: string }>(user ? doc(db, 'users', user.uid) : null, [user?.uid]);
  const householdId = userDoc.data?.householdId ?? null;
  const hp = householdId ? `households/${householdId}` : null;

  const household = useDocument<Household>(hp ? doc(db, hp) : null, [hp]);
  const members = useQuery<Member>(hp ? collection(db, hp, 'members') : null, [hp]);
  const vendors = useQuery<Vendor>(hp ? collection(db, hp, 'vendors') : null, [hp]);
  const items = useQuery<Item>(hp ? collection(db, hp, 'items') : null, [hp]);
  const since = addDaysStr(todayStr(), -60);
  const recentOrders = useQuery<Order>(
    hp ? query(collection(db, hp, 'orders'), where('forDate', '>=', since), orderBy('forDate', 'desc')) : null,
    [hp, since],
  );
  const stockEvents = useQuery<StockEvent>(
    hp ? query(collection(db, hp, 'stockEvents'), orderBy('at', 'desc'), limit(300)) : null,
    [hp],
  );
  const queue = useQuery<QueueEntry>(hp ? collection(db, hp, 'nextOrderQueue') : null, [hp]);

  const lang: Lang = household.data?.languagePref ?? localLang;
  useEffect(() => {
    document.documentElement.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  }, [lang]);

  const value = useMemo<Ctx>(
    () => ({
      user,
      authReady,
      householdId,
      householdReady: authReady && (!user || !userDoc.loading),
      household: household.data,
      members: members.data,
      vendors: vendors.data,
      items: items.data,
      recentOrders: recentOrders.data,
      stockEvents: stockEvents.data,
      queue: queue.data,
      lang,
      setLocalLang: (l) => setLocalLangState(l),
      t: (key, vars) => translate(lang, key, vars),
    }),
    [user, authReady, householdId, userDoc.loading, household.data, members.data, vendors.data, items.data,
      recentOrders.data, stockEvents.data, queue.data, lang],
  );
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): Ctx {
  const c = useContext(HouseholdContext);
  if (!c) throw new Error('HouseholdProvider missing');
  return c;
}

/** Household doc path helper for writes. */
export const hpath = (householdId: string, ...segments: string[]) => ['households', householdId, ...segments].join('/');
