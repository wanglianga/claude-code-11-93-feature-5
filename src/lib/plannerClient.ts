// 主线程的 Worker 客户端：发规划请求、收结果
import type { PlanPayload, PlanResult } from './planner';

let worker: Worker | null = null;
let reqSeq = 0;
const pending = new Map<number, { resolve: (r: PlanResult) => void; reject: (e: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../worker/planner.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { reqId, result, error } = e.data;
      const p = pending.get(reqId);
      if (!p) return;
      pending.delete(reqId);
      if (error) p.reject(new Error(error));
      else p.resolve(result as PlanResult);
    };
  }
  return worker;
}

export function runPlanInWorker(payload: PlanPayload): Promise<PlanResult> {
  const w = getWorker();
  reqSeq += 1;
  const reqId = reqSeq;
  return new Promise((resolve, reject) => {
    pending.set(reqId, { resolve, reject });
    w.postMessage({ reqId, payload });
  });
}
