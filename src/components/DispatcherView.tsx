// 调度员工作台：地图 + 路线清单 + 限行/封闭管理 + 双方案重排 + 演示事件
import React, { useMemo, useState } from 'react';
import type { Snapshot } from '../lib/db';
import type { Account } from '../types';
import { fmtMin } from '../types';
import {
  advanceClock, applyPlan, buildPlanPayload, computeRouteEvals, currentVersionByVehicle,
  demoDumpEarlyClose, demoOldDriverLateReceipt, liftClosure, resetDemo, setClock,
} from '../lib/actions';
import { runPlanInWorker } from '../lib/plannerClient';
import type { PlanResult } from '../lib/planner';
import { MapView } from './MapView';
import { PlanCompare } from './PlanCompare';
import { EventLogPanel, StationBadge, VersionTracePanel, VEHICLE_COLORS } from './Shared';
import { BRIDGE_CLOSE_TO } from '../lib/seed';

export function DispatcherView({ snap, account }: { snap: Snapshot; account: Account }) {
  const [planA, setPlanA] = useState<PlanResult | null>(null);
  const [planB, setPlanB] = useState<PlanResult | null>(null);
  const [planning, setPlanning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [appliedNote, setAppliedNote] = useState('');
  const [demoMsg, setDemoMsg] = useState('');

  const routeEvals = useMemo(() => computeRouteEvals(snap), [snap]);
  const versions = useMemo(() => currentVersionByVehicle(snap), [snap]);

  const generatePlans = async () => {
    setPlanning(true);
    setAppliedNote('');
    try {
      const [a, b] = await Promise.all([
        runPlanInWorker(buildPlanPayload(snap, 'insert')),
        runPlanInWorker(buildPlanPayload(snap, 'global')),
      ]);
      setPlanA(a);
      setPlanB(b);
    } finally {
      setPlanning(false);
    }
  };

  const onApply = async (plan: PlanResult) => {
    setApplying(true);
    try {
      const reason = plan.strategy === 'insert' ? '封路重排（最小变更）' : '封路重排（全局优化）';
      await applyPlan(snap, plan, account.name, reason);
      setAppliedNote(`已应用${plan.strategy === 'insert' ? '方案 A（最小变更）' : '方案 B（全局重排）'}，新线路版本已生效，需重发通知 ${plan.resends.length} 条`);
    } finally {
      setApplying(false);
    }
  };

  const unfinishedCount = snap.stations.filter((s) => s.status !== 'completed').length;

  return (
    <div className="layout">
      <div className="col-left">
        <MapView snap={snap} />

        <div className="panel">
          <h3>路线清单（当前版本 · 实时 ETA · 载重核验）</h3>
          {snap.vehicles.map((v) => {
            const rv = versions[v.id];
            const ev = routeEvals.get(v.id);
            const etaByStation = new Map(ev?.legs.map((l) => [l.stationId, l]) ?? []);
            return (
              <div key={v.id} className="veh-block">
                <div className="veh-head">
                  <span className="veh-dot" style={{ background: VEHICLE_COLORS[v.id] }} />
                  <b>{v.name}</b>（{v.plate}）
                  <span className="muted">司机 {v.driverName}</span>
                  <span className="mono">载重 {v.loadTon.toFixed(1)}/{v.capacityTon.toFixed(1)}t</span>
                  <span className="muted">限高{v.heightM}m 限宽{v.widthM}m</span>
                  <span className="tag">版本 {rv?.id ?? '—'}</span>
                </div>
                <div className="loadbar">
                  <div className="loadbar-fill" style={{ width: `${Math.min(100, (v.loadTon / v.capacityTon) * 100)}%`, background: VEHICLE_COLORS[v.id] }} />
                </div>
                <table className="tbl small">
                  <thead>
                    <tr><th>序</th><th>站点</th><th>估重/实称</th><th>服务截止</th><th>状态</th><th>预计到达</th><th>装载后载重</th></tr>
                  </thead>
                  <tbody>
                    {(rv?.stopIds ?? []).map((sid, i) => {
                      const st = snap.stations.find((s) => s.id === sid)!;
                      const leg = etaByStation.get(sid);
                      return (
                        <tr key={sid} className={st.status === 'completed' ? 'row-done' : ''}>
                          <td className="mono">{i + 1}</td>
                          <td>{sid} {st.name}</td>
                          <td className="mono">估{st.estTon}t{st.actualTon != null ? ` / 实${st.actualTon}t` : ''}</td>
                          <td className="mono">{fmtMin(st.deadlineMin)}</td>
                          <td><StationBadge status={st.status} overflow={st.overflowReported} /></td>
                          <td className="mono">{st.status === 'completed' ? `${fmtMin(st.completedAtMin!)} 已完成` : leg ? fmtMin(leg.arriveMin) : '—'}</td>
                          <td className="mono">{leg ? `${leg.loadAfterTon.toFixed(1)}t` : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {ev && ev.violations.length > 0 && (
                  <div className="alert">当前线路不可行：{ev.violations.map((x) => x.reason).join('；')} —— 请生成重排方案</div>
                )}
                {ev && <div className="muted small">卸载核验：{ev.dump.note}</div>}
              </div>
            );
          })}
        </div>

        <div className="panel">
          <h3>道路限行与封闭</h3>
          <table className="tbl small">
            <thead><tr><th>道路</th><th>状态</th><th>时段</th><th>原因</th><th>操作</th></tr></thead>
            <tbody>
              {snap.closures.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}（{c.roadGroup}）</td>
                  <td><span className="badge red">封闭中</span></td>
                  <td className="mono">{fmtMin(c.fromMin)}–{fmtMin(c.toMin)}</td>
                  <td>{c.reason}</td>
                  <td><button className="btn small" onClick={() => liftClosure(snap, c.id, account.name)}>提前解除</button></td>
                </tr>
              ))}
              {snap.closures.length === 0 && <tr><td colSpan={5} className="muted">当前无封闭。清河桥已于 10:15 恢复通行。</td></tr>}
            </tbody>
          </table>
          <div className="muted small">
            限行：市场高架（S2↔S4）限高 2.6m（T1 高 3.1m 不可通行）；车场↔S2 限宽 2.5m。
            卸载点：{snap.dumps.map((d) => `${d.name} ${d.windows.map((w) => `${fmtMin(w.startMin)}–${fmtMin(w.endMin)}`).join('、')}`).join('；')}
          </div>
        </div>

        {planA && planB && (
          <PlanCompare planA={planA} planB={planB} snap={snap} onApply={onApply} applying={applying} />
        )}
        {appliedNote && <div className="panel ok-panel">{appliedNote}</div>}

        <VersionTracePanel versions={snap.routeVersions} />
        <EventLogPanel events={snap.events} />
      </div>

      <div className="col-right">
        <div className="panel">
          <h3>重排决策</h3>
          <p className="muted small">
            未完成站点 {unfinishedCount} 个。重排在 WebWorker 中计算，同时给出“最小变更”和“全局重排”两个可行方案并列对比。
          </p>
          <button className="btn primary block" disabled={planning || unfinishedCount === 0} onClick={generatePlans}>
            {planning ? 'Worker 计算中…' : '生成方案 A（最小变更）与方案 B（全局重排）'}
          </button>
          {unfinishedCount === 0 && <div className="ok small">全部站点已履约，无需重排。</div>}
        </div>

        <div className="panel demo">
          <h3>演示与验证（一键注入题目输入）</h3>
          <button className="btn block" onClick={async () => { await resetDemo(); setPlanA(null); setPlanB(null); setAppliedNote(''); setDemoMsg('已重置并重放到 09:20 封路通知现场'); }}>
            ① 重置并重放初始场景（09:20 封路）
          </button>
          <button className="btn block" onClick={async () => { await demoDumpEarlyClose(snap, account.name); setDemoMsg('已注入：卸载点 D1 提前至 10:00 关闭'); }}>
            ② 演示事件：卸载点 D1 提前至 10:00 关闭
          </button>
          <button className="btn block" onClick={async () => {
            const r = await demoOldDriverLateReceipt(snap);
            setDemoMsg(`老王迟到的离线回执（S2 扫码，依据 RV-T1-1）→ 判定：${r.verdict}${r.note ? `（${r.note}）` : ''}；再次点击同一按钮可验证“同一凭证重传只计一次”`);
          }}>
            ③ 演示事件：老王迟到的离线回执上传（S2 已移交）
          </button>
          <button className="btn block" onClick={async () => { await setClock(BRIDGE_CLOSE_TO, account.name, '时钟推进至 10:15，清河桥封闭解除'); setDemoMsg('时钟已到 10:15，桥梁封闭自动失效'); }}>
            ④ 演示事件：时钟推进到 10:15（封路解除）
          </button>
          <button className="btn block" onClick={() => advanceClock(5, account.name)}>时钟 +5 分钟</button>
          {demoMsg && <div className="demo-msg">{demoMsg}</div>}
        </div>

        <div className="panel">
          <h3>回执流水（含幂等/冲突判定）</h3>
          <table className="tbl small">
            <thead><tr><th>回执号</th><th>动作</th><th>站点</th><th>执行人</th><th>依据版本</th><th>判定</th></tr></thead>
            <tbody>
              {snap.receipts.slice().reverse().slice(0, 20).map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{r.id}</td>
                  <td>{r.action}</td>
                  <td>{r.stationId ?? '—'}</td>
                  <td>{r.executorName}</td>
                  <td className="mono small">{r.routeVersionId}</td>
                  <td>
                    <span className={`badge ${r.status === 'accepted' ? 'green' : r.status === 'duplicate' ? 'gray' : 'red'}`}>
                      {r.status === 'accepted' ? '已入账' : r.status === 'duplicate' ? '重复' : '冲突'}
                    </span>
                    {r.note && <div className="muted tiny">{r.note}</div>}
                  </td>
                </tr>
              ))}
              {snap.receipts.length === 0 && <tr><td colSpan={6} className="muted">暂无回执</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
