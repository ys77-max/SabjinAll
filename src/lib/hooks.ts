import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  onSnapshot,
  type DocumentReference,
  type Query,
  type DocumentData,
} from 'firebase/firestore';

export interface Snap<T> {
  data: T;
  loading: boolean;
  error: Error | null;
  /** true when served from the local cache only (offline) */
  fromCache: boolean;
}

/** Live query from Firestore. Serves cached data offline (persistentLocalCache). */
export function useQuery<T>(q: Query<DocumentData> | null, deps: unknown[]): Snap<T[]> {
  const [state, setState] = useState<Snap<T[]>>({ data: [], loading: !!q, error: null, fromCache: false });
  useEffect(() => {
    if (!q) {
      setState({ data: [], loading: false, error: null, fromCache: false });
      return;
    }
    setState((s) => ({ ...s, loading: true }));
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as T),
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
        }),
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

export function useDocument<T>(ref: DocumentReference<DocumentData> | null, deps: unknown[]): Snap<T | null> {
  const [state, setState] = useState<Snap<T | null>>({ data: null, loading: !!ref, error: null, fromCache: false });
  useEffect(() => {
    if (!ref) {
      setState({ data: null, loading: false, error: null, fromCache: false });
      return;
    }
    return onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.exists() ? ({ id: snap.id, ...snap.data({ serverTimestamps: 'estimate' }) } as T) : null,
          loading: false,
          error: null,
          fromCache: snap.metadata.fromCache,
        }),
      (error) => setState((s) => ({ ...s, loading: false, error })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
export const useOnline = () => useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);

/** Long-press detection that keeps tap separate. Returns pointer handlers. */
export function useLongPress(onTap: () => void, onLong: () => void, ms = 450) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const active = useRef(false);
  const clear = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      fired.current = false;
      active.current = true;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        navigator.vibrate?.(20);
        onLong();
      }, ms);
    },
    onPointerUp: () => {
      clear();
      if (active.current && !fired.current) onTap();
      active.current = false;
    },
    onPointerLeave: () => { clear(); active.current = false; },
    onPointerCancel: () => { clear(); active.current = false; },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}
