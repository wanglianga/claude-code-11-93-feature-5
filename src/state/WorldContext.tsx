// 全局快照：IndexedDB → React 上下文；任何领域动作完成后通过 bus 触发刷新
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isSeeded, loadSnapshot, resetAndSeed, type Snapshot } from '../lib/db';
import { bus } from '../lib/actions';

const WorldCtx = createContext<{ snap: Snapshot | null; refresh: () => Promise<void> }>({
  snap: null,
  refresh: async () => {},
});

export function WorldProvider({ children }: { children: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(async () => {
    const s = await loadSnapshot();
    setSnap(s);
  }, []);

  useEffect(() => {
    (async () => {
      if (!(await isSeeded())) await resetAndSeed();
      await refresh();
    })();
    const onChange = () => void refresh();
    bus.addEventListener('change', onChange);
    return () => bus.removeEventListener('change', onChange);
  }, [refresh]);

  return <WorldCtx.Provider value={{ snap, refresh }}>{children}</WorldCtx.Provider>;
}

export function useWorld() {
  return useContext(WorldCtx);
}
