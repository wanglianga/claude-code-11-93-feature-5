/// <reference lib="webworker" />
// 规划 Worker：线路重排在后台线程计算，不阻塞页面
import { runPlan, type PlanPayload } from '../lib/planner';

self.onmessage = (e: MessageEvent) => {
  const { reqId, payload } = e.data as { reqId: number; payload: PlanPayload };
  try {
    const result = runPlan(payload);
    (self as unknown as Worker).postMessage({ reqId, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ reqId, error: String(err) });
  }
};
