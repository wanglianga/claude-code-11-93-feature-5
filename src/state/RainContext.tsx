// 暴雨首轮安排的 React 状态容器：useReducer + localStorage 持久化
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import {
  initialRainState,
  rainReducer,
  type RainAction,
  type RainState,
} from '../lib/rainstorm';

const KEY = 'rain-board-state-v1';

function init(): RainState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as RainState;
      // 简单形状校验，损坏/旧版缓存直接回到题目初始现场
      if (parsed && Array.isArray(parsed.stations) && parsed.vehicle) return parsed;
    }
  } catch {
    /* ignore */
  }
  return initialRainState();
}

const Ctx = createContext<{ state: RainState; dispatch: React.Dispatch<RainAction> } | null>(null);

export function RainProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(rainReducer, undefined, init);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* 存储不可用时仅内存态 */
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRain() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRain 必须在 <RainProvider> 内使用');
  return ctx;
}
