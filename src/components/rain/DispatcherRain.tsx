// 调度员面板：窗口/载重、区间来源、排序准则、逐步推演、确认发布、人工改序、增援待办
import { useMemo, useState } from 'react';
import { useRain } from '../../state/RainContext';
import {
  NOW_MIN,
  WEATHER_CUTOFF_MIN,
  analyzeRain,
  checkPublish,
  fmtMin,
  offBoardTodos,
  taskInvalidReasons,
  evalFirstStop,
  type RainStation,
} from '../../lib/rainstorm';
import { Badge, LoadBar, Panel, Timeline } from './bits';

function StationEstimateCard({ st }: { st: RainStation }) {
  const e = st.estimate;
  const sensor = st.sensor;
  return (
    <div className={`rain-station-card level-${st.level}`} data-testid={`station-card-${st.code}`}>
      <div className="rain-station-head">
        <span className="rain-station-code">{st.code}</span>
        <div>
          <div className="rain-station-name">
            {st.name}
            {st.level === 'hospital' && <Badge tone="red">敏感服务等级</Badge>}
            {st.level === 'ordinary' && <Badge tone="blue">常规等级</Badge>}
          </div>
          <div className="small muted">{st.levelLabel} · 容器容量 {st.containerCapTon.toFixed(1)}t</div>
        </div>
        <div className="rain-station-deadline">
          <div className="small muted">清运完成截止</div>
          <b className="mono">{fmtMin(st.deadlineMin)}</b>
          {st.deadlineMin === WEATHER_CUTOFF_MIN && <Badge tone="orange">同暴雨窗口</Badge>}
        </div>
      </div>

      <div className="rain-estimate-grid">
        <div>
          <div className="small muted">估计满溢率区间（排序键）</div>
          <div className="rain-range-pct">
            {e.fullnessLowPct}%–{e.fullnessHighPct}%
            <Badge tone="indigo">上界 {e.fullnessHighPct}%</Badge>
          </div>
        </div>
        <div>
          <div className="small muted">估计吨位区间（仅容量判断）</div>
          <div className="rain-range-ton mono">
            {e.tonLow.toFixed(3)}–{e.tonHigh.toFixed(2)}t
          </div>
        </div>
        <div>
          <div className="small muted">传感器状态</div>
          <div>
            {sensor.reportingNow ? <Badge tone="green">实时有报</Badge> : <Badge tone="red">当前缺报</Badge>}
            <span className="small muted">
              {sensor.missingSinceMin !== undefined && `自 ${fmtMin(sensor.missingSinceMin)} 起`}
            </span>
          </div>
        </div>
      </div>

      <p className="rain-source" data-testid={`source-${st.code}`}>
        <b>区间来源：</b>{sensor.sourceSummary}
      </p>
      <div className="small muted">
        最近有效读数：{fmtMin(sensor.lastValidSampleAtMin)} · {sensor.lastValidFullnessPct}%；{sensor.prevDayActualText}
      </div>

      {sensor.readings.some((r) => r.kind === 'backfill-late') && (
        <ul className="rain-readings" data-testid={`backfill-${st.code}`}>
          {sensor.readings
            .filter((r) => r.kind === 'backfill-late')
            .map((r) => (
              <li key={r.id} className="rain-reading-late">
                <Badge tone="orange">迟到补报</Badge>
                采样 <b className="mono">{fmtMin(r.sampleAtMin)}</b> · 接收{' '}
                <b className="mono">{fmtMin(r.receivedAtMin)}</b> · 满溢 {r.fullnessPct}%
                {r.stale && <span>（采样早于已采用的最近有效读数，仅归档，不当当前实测）</span>}
              </li>
            ))}
        </ul>
      )}

      {e.revised && e.revisionNote && <div className="alert strong rain-revision">⚠ {e.revisionNote}</div>}
    </div>
  );
}

function DemoBar() {
  const { dispatch } = useRain();
  return (
    <Panel title="演示与验证注入（题目要求的四种变化）" className="demo rain-demo">
      <div className="btn-row">
        <button className="btn small" data-testid="demo-h-over" onClick={() => dispatch({ type: 'demoHOver' })}>
          ① H 估计更新为超过 1 吨
        </button>
        <button
          className="btn small"
          data-testid="demo-r-early"
          onClick={() => dispatch({ type: 'demoRDeadlineEarly' })}
        >
          ② R 截止提前到 09:30
        </button>
        <button
          className="btn small"
          data-testid="demo-backfill"
          onClick={() => dispatch({ type: 'demoBackfillEarlier' })}
        >
          ③ 缺报补齐（采样时间更早的迟到报文）
        </button>
        <button
          className="btn small ghost"
          onClick={() => {
            if (confirm('确定重置为 09:20 题目初始现场？')) dispatch({ type: 'reset' });
          }}
        >
          ↺ 重置现场
        </button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        ④「确认后司机实称超限」请在发布任务后切换到「司机端」，称重时一键填入 1.10t 验证。
      </p>
    </Panel>
  );
}

function PublishCard() {
  const { state, dispatch } = useRain();
  const a = useMemo(() => analyzeRain(state), [state]);
  const check = useMemo(() => checkPublish(state), [state]);
  const invalidReasons = taskInvalidReasons(state);
  const [showManual, setShowManual] = useState(false);

  const windowOk = state.windowAckRev === state.basisRev;
  const estimateOk = state.estimateAckRev === state.basisRev;
  const task = state.task;
  const taskStation = state.stations.find((x) => x.id === task?.stationId);

  // 已派单后的状态视图（本窗口一辆车只发布一个首站）
  if (task && task.status !== 'replanned') {
    return (
      <Panel title="③ 确认任务（已发布到司机端）" testid="published-card">
        <div className={`alert ${invalidReasons.length ? 'strong' : ''} ${task.status === 'done' ? 'ok-panel' : ''}`}>
          <div>
            <Badge tone={task.mode === 'auto' ? 'blue' : 'indigo'}>
              {task.mode === 'auto' ? '自动准则发布' : '人工改序发布'}
            </Badge>
            <b>
              首站 {task.stationId} · {taskStation?.name}
            </b>
            {task.status === 'done' && <Badge tone="green">已清运完成</Badge>}
            {task.status === 'active' && <Badge tone="green">执行中</Badge>}
          </div>
          {task.manualReason && (
            <div className="small" style={{ marginTop: 6 }}>
              人工改序理由（已留痕）：{task.manualReason}
            </div>
          )}
        </div>

        {invalidReasons.length > 0 && (
          <div className="alert strong rain-invalid" data-testid="task-invalid">
            <b>⚠ 已发布建议失效：</b>
            <ul>
              {invalidReasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            <button
              className="btn primary small"
              data-testid="replan-btn"
              onClick={() => dispatch({ type: 'dispatcherReplan' })}
            >
              停收 / 终止原任务并重新排定增援
            </button>
          </div>
        )}

        {task.status === 'done' && invalidReasons.length === 0 && (
          <p className="small ok">
            {task.stationId} 已在截止前合规完成。另一站的二站线路经 U 卸空推演必然失约，仍只走「待增援」，
            不向本车续发该站开工指令。
          </p>
        )}
        {task.status === 'active' && invalidReasons.length === 0 && (
          <p className="small muted">可切换到顶部「司机端」执行到站 / 扫码 / 称重。输入再变化时本任务会立即标记失效。</p>
        )}
      </Panel>
    );
  }

  if (task && task.status === 'replanned') {
    return (
      <Panel title="③ 重排结论" testid="replanned-card">
        <div className="alert strong">
          原 {task.stationId} 任务已终止（第 {state.replanCount} 次重排）。按当前时间、估计与实称重新核验后，
          剩余站点均列入右侧「待增援 / 交接」，<b>不向本车续发新的站点开工指令</b>。
        </div>
        <p className="small muted">
          如需重新演示完整派单，请点「↺ 重置现场」回到 09:20。10:00 后看板只保留撤离与交接待办。
        </p>
      </Panel>
    );
  }

  if (a.postCutoff) {
    return (
      <Panel title="③ 确认与发布">
        <div className="alert strong bad" data-testid="post-cutoff-publish">
          已到/已过 10:00：停止站点装运，<b>不再发布任何站点开工任务</b>。请在右侧确认撤离与交接。
        </div>
      </Panel>
    );
  }

  const manualCandidate = state.manualId ? state.stations.find((x) => x.id === state.manualId) : null;
  const manualEval = manualCandidate ? evalFirstStop(manualCandidate, state.vehicle, state.nowMin) : null;

  return (
    <Panel title="③ 确认前核对并发布本窗口唯一首站" testid="publish-card">
      <div className="rain-checks">
        <label className={windowOk ? 'is-ok' : ''}>
          <input
            type="checkbox"
            checked={windowOk}
            onChange={() => dispatch({ type: 'ackWindow' })}
            data-testid="check-window"
          />
          <span>
            已核对<b>窗口</b>：暴雨要求 10:00 起停止站点装运；合规以「清运完成时刻」为准，恰在截止点算合规，
            赶到不算完成；R 截止 09:50、H 截止 10:00。
          </span>
        </label>
        <label className={estimateOk ? 'is-ok' : ''}>
          <input
            type="checkbox"
            checked={estimateOk}
            onChange={() => dispatch({ type: 'ackEstimate' })}
            data-testid="check-estimate"
          />
          <span>
            已核对<b>估计修订</b>：两站传感器缺报，展示的是区间估计而非 0 或实测；任何①②③类修订/补报后须重新核对。
          </span>
        </label>
      </div>

      <div className="rain-suggest-box" data-testid="suggested-box">
        <div className="small muted">自动建议（满溢率上界优先，且必须通过硬约束）</div>
        <div className="rain-suggest-id" data-testid="suggested-id">
          {a.suggestedFirstId ? `首站 ${a.suggestedFirstId}` : '无合法首站'}
        </div>
        <p className="small" style={{ margin: '4px 0 0' }}>{a.suggestionReason}</p>
      </div>

      <div className="rain-manual">
        <button className="btn tiny ghost" onClick={() => setShowManual((v) => !v)} data-testid="toggle-manual">
          {showManual ? '收起人工改序' : '需要人工改序？（必须填理由并重新验证）'}
        </button>
        {showManual && (
          <div className="rain-manual-box">
            <div className="btn-row">
              <button
                className={`btn small ${state.manualId === null ? 'primary' : ''}`}
                onClick={() => dispatch({ type: 'chooseAuto' })}
              >
                跟随自动建议
              </button>
              {state.stations.map((st) => (
                <button
                  key={st.id}
                  className={`btn small ${state.manualId === st.id ? 'primary' : ''}`}
                  data-testid={`manual-pick-${st.code}`}
                  onClick={() => dispatch({ type: 'chooseManual', stationId: st.id })}
                >
                  人工指定 {st.code} 先做
                </button>
              ))}
            </div>
            {state.manualId && (
              <>
                <textarea
                  className="input rain-reason"
                  placeholder="必须填写人工改序理由，例如：医院发热门诊医废/满溢敏感，要求优先保障……"
                  value={state.manualReason}
                  data-testid="manual-reason-input"
                  onChange={(e) => dispatch({ type: 'setManualReason', reason: e.target.value })}
                />
                {manualEval && (
                  <div className={`alert ${manualEval.feasible ? 'ok-panel' : 'strong'}`} data-testid="manual-revalidate">
                    {manualEval.feasible
                      ? `重新验证通过：${state.manualId} 预计 ${fmtMin(manualEval.completeMin)} 完成，载重上界 ${manualEval.estTonHigh.toFixed(2)}t ≤ 余量 ${manualEval.remainingTon.toFixed(2)}t。`
                      : `重新验证不通过，人工选择不能越过硬约束：${manualEval.violations
                          .map((v) => v.message)
                          .join('；')}`}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {check.blockers.length > 0 && (
        <ul className="rain-blockers" data-testid="publish-blockers">
          {check.blockers.map((b, i) => (
            <li key={i} className="bad">
              • {b}
            </li>
          ))}
        </ul>
      )}

      <button
        className="btn primary block"
        disabled={!check.ok}
        data-testid="publish-btn"
        onClick={() => dispatch({ type: 'publish' })}
      >
        {check.chosenId ? `确认并向司机发布：仅 ${check.chosenId} 一站（本窗口首轮合法任务）` : '暂无可发布首站'}
      </button>
    </Panel>
  );
}

function ReinforcePanel() {
  const { state, dispatch } = useRain();
  const a = useMemo(() => analyzeRain(state), [state]);
  const todos = offBoardTodos(state);

  return (
    <>
      <Panel title="待增援与预计失约（另一站 / 硬约束失败站）" testid="reinforce-panel">
        {a.reinforcements.length === 0 && <p className="small muted">当前没有待增援事项。</p>}
        <div className="rain-reinforce-list" data-testid="reinforce-list">
          {a.reinforcements.map((r) => (
            <div key={r.stationId + r.kind} className="rain-reinforce-item" data-testid={`reinforce-${r.stationId}`}>
              <div className="rain-reinforce-title">
                <Badge tone={r.kind === 'second-leg-miss' ? 'orange' : 'red'}>
                  {r.kind === 'second-leg-miss' ? '二站来不及' : r.kind === 'actual-overload' ? '实称超限' : '硬约束失败'}
                </Badge>
                <b>{r.title}</b>
              </div>
              <p className="small">{r.detail}</p>
              <p className="small rain-risk">📢 {r.appointmentRisk}</p>
            </div>
          ))}
        </div>
        <div className="rain-pending" data-testid="pending-service">
          <b>仍待服务对象：</b>
          {a.pendingServiceIds.length === 0 ? (
            <Badge tone="green">全部完成</Badge>
          ) : (
            a.pendingServiceIds.map((id) => {
              const st = state.stations.find((x) => x.id === id)!;
              return (
                <Badge key={id} tone={st.status === 'rejected' ? 'red' : st.status === 'completed' ? 'green' : 'orange'}>
                  {id} · {st.status === 'rejected' ? '停收待援' : statusText(st.status)}
                </Badge>
              );
            })
          )}
        </div>
      </Panel>

      {state.nowMin >= WEATHER_CUTOFF_MIN && (
        <Panel title="10:00 后：仅撤离与交接" className="rain-offboard" testid="offboard-panel">
          {todos.map((t) => (
            <div key={t.id} className="rain-todo">
              <div>
                <b>{t.title}</b>
                <p className="small muted">{t.detail}</p>
              </div>
              <button
                className={`btn small ${t.ack ? '' : 'primary'}`}
                disabled={t.ack}
                data-testid={`ack-${t.id}`}
                onClick={() => dispatch({ type: t.id === 'evac' ? 'ackEvac' : 'ackHandover' })}
              >
                {t.ack ? '✓ 已确认' : '确认'}
              </button>
            </div>
          ))}
        </Panel>
      )}
    </>
  );
}

function statusText(s: RainStation['status']) {
  switch (s) {
    case 'pending':
      return '待安排';
    case 'tasked':
      return '已派单';
    case 'arrived':
      return '已到站';
    case 'scanned':
      return '已扫码';
    case 'completed':
      return '已完成';
    case 'rejected':
      return '停收';
  }
}

function LogPanel() {
  const { state } = useRain();
  return (
    <Panel title="事件与留痕（排序/改序/发布/称重/修订）">
      <div className="rain-log" data-testid="rain-log">
        {state.logs.map((l) => (
          <div key={l.id} className={`rain-log-line tone-${l.tone ?? 'info'}`}>
            <span className="mono rain-log-time">{fmtMin(l.atMin)}</span>
            <span className="rain-log-actor">{l.actor}</span>
            <span>{l.message}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function DispatcherRain() {
  const { state } = useRain();
  const a = useMemo(() => analyzeRain(state), [state]);
  const projRH = a.projections['R->H'];
  const projHR = a.projections['H->R'];

  return (
    <div className="rain-dispatcher" data-testid="dispatcher-view">
      <div className="rain-banner-window">
        <div>
          <b>🌧 暴雨预警 · 首轮有限运力安排</b>
          <div className="small">
            当前 {fmtMin(state.nowMin)}（题设 09:20）；<b>{fmtMin(WEATHER_CUTOFF_MIN)} 起停止站点装运</b>，
            到点未完成的清运不合规——以清运完成时刻为准，赶到站点不算完成。
          </div>
        </div>
        <Badge tone={a.postCutoff ? 'red' : 'green'}>
          {a.postCutoff ? '窗口已关闭：只撤离/交接' : '装运窗口开放中'}
        </Badge>
      </div>

      <DemoBar />

      <div className="rain-layout">
        <div className="rain-col-main">
          <Panel title="车辆当前载重与可用余量" testid="vehicle-card">
            <div className="rain-vehicle">
              <div>
                <b>{state.vehicle.name}</b>（{state.vehicle.plate}）
              </div>
              <div className="rain-kpis">
                <div className="kpi">
                  <span className="kpi-num mono">{state.vehicle.loadTon.toFixed(2)}</span>当前载重 t
                </div>
                <div className="kpi">
                  <span className="kpi-num mono">{state.vehicle.capacityTon.toFixed(1)}</span>额定 t
                </div>
                <div className="kpi">
                  <span className="kpi-num mono bad">{(state.vehicle.capacityTon - state.vehicle.loadTon).toFixed(2)}</span>
                  可用余量 t
                </div>
              </div>
              <LoadBar load={state.vehicle.loadTon} capacity={state.vehicle.capacityTon} />
              <p className="small muted" style={{ marginBottom: 0 }}>
                题目仅指定可用余量 1.0t；本演示车取额定 2.0t、早班在载 1.0t。只有在 U「确认卸空」后载重才归零、余量恢复全额，
                计划到 U 不释放载重。
              </p>
            </div>
          </Panel>

          <Panel title="两站估计区间与来源（传感器缺报 · 禁止填零/冒充实测）">
            <div className="rain-station-grid">
              {state.stations.map((st) => (
                <StationEstimateCard key={st.id} st={st} />
              ))}
            </div>
          </Panel>

          <Panel title="自动建议准则（本题已选定，不设两个策略切换按钮）" testid="policy-card">
            <div className="rain-policy">
              <Badge tone="blue">已采用</Badge>
              <b>估计满溢率上界优先</b>
              <p>
                排序键：满溢率上界降序 → 相同则按稳定站号。当前 <b>R 100% &gt; H 95%</b>，故自动建议 <b>R 先</b>。
                R 最接近满溢，且其截止 09:50 更早。<b>吨位上界 0.70t / 0.95t 只用于容量判断，不混作满溢排序</b>
                （两站容器容量不同，直接比吨位会错误地让 H 在前）。
              </p>
              <div className="rain-policy-alt">
                <Badge tone="gray">另一准则（仅说明）</Badge>
                <b>敏感服务等级优先：</b>医院 H 先，同等级再比满溢率上界，仍相同按稳定站号。
                它保护的是<b>医院 H</b>——优先保障医疗/敏感服务连续性、降低院感与舆情风险；
                代价是让<b>普通街区 R 的居民等待</b>，而 R 恰是满溢上界最高（100%）、截止更早（09:50）的点，漫溢风险由普通居民承担。
                本场景下两种准则都<b>只能发布首站</b>：差别仅是谁拿到唯一合法确认席位、谁转为增援与预计失约。
              </div>
            </div>
          </Panel>

          <Panel title="逐步时刻推演（09:20 起点；两种顺序的二站线路均不合法）" testid="deduction-card">
            <div className="rain-proj-grid">
              <div>
                <h4>方案顺序 R →（U 卸空）→ H</h4>
                <div className="rain-first-ok">
                  首站 R：<b className="ok">09:36 完成，合法</b>
                </div>
                {projRH && <Timeline steps={projRH.steps} testid="timeline-rh" />}
                <div className="alert bad strong">
                  H 最早 {fmtMin(projRH.secondCompleteMin)} 完成，晚于 H 截止 10:00 共 {projRH.lateByMin} 分钟 →
                  二站线路不可执行，H 必须另行增援。
                </div>
              </div>
              <div>
                <h4>方案顺序 H →（U 卸空）→ R</h4>
                <div className="rain-first-ok">
                  首站 H：<b className="ok">09:40 完成，合法</b>
                </div>
                {projHR && <Timeline steps={projHR.steps} testid="timeline-hr" />}
                <div className="alert bad strong">
                  R 最早 {fmtMin(projHR.secondCompleteMin)} 完成，晚于 R 截止 09:50 共 {projHR.lateByMin} 分钟 →
                  人工改 H 先同样不能把 R 标作可执行。
                </div>
              </div>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              两站估计最低合量 {projRH?.minCombinedTon.toFixed(3)}t（0.665 + 0.80）&gt; 可用余量{' '}
              {projRH?.remainingTon.toFixed(2)}t，故装完首站必须到 U 卸空；上述二站时刻已包含 U 行驶 10 + 卸 5 + U
              到另一站 10 + 作业 8。
            </p>
          </Panel>

          <PublishCard />
        </div>

        <div className="rain-col-side">
          <ReinforcePanel />
          <LogPanel />
        </div>
      </div>
    </div>
  );
}
