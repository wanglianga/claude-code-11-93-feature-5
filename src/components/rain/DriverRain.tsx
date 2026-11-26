// 司机端：只看到本窗口唯一合法首站；到站/扫码/称重，超限停收；U 确认卸空才恢复余量
import { useMemo, useState } from 'react';
import { useRain } from '../../state/RainContext';
import {
  WEATHER_CUTOFF_MIN,
  analyzeRain,
  fmtMin,
  offBoardTodos,
  remainingTon,
} from '../../lib/rainstorm';
import { Badge, LoadBar, Panel } from './bits';

export function DriverRain() {
  const { state, dispatch } = useRain();
  const [weighText, setWeighText] = useState('');
  const task = state.task;
  const st = state.stations.find((x) => x.id === task?.stationId) ?? null;
  const postCutoff = state.nowMin >= WEATHER_CUTOFF_MIN;
  const todos = offBoardTodos(state);
  const analysis = useMemo(() => analyzeRain(state), [state]);

  return (
    <div className="rain-driver" data-testid="driver-view">
      <Panel title="我的车辆与载重">
        <div className="rain-vehicle">
          <div>
            <b>{state.vehicle.name}</b>（{state.vehicle.plate}） · 司机 王师傅
          </div>
          <div className="rain-kpis">
            <div className="kpi">
              <span className="kpi-num mono">{state.vehicle.loadTon.toFixed(2)}</span>当前载重 t
            </div>
            <div className="kpi">
              <span className="kpi-num mono bad">{remainingTon(state.vehicle).toFixed(2)}</span>可用余量 t
            </div>
          </div>
          <LoadBar load={state.vehicle.loadTon} capacity={state.vehicle.capacityTon} />
          <div className="small muted">
            位置节点：<b>{state.node}</b>；只有在 U 点「确认卸空」后余量才恢复，计划去 U 不会提前释放载重。
          </div>
        </div>
      </Panel>

      {postCutoff && (
        <Panel title="10:00 后：停止站点开工" className="rain-offboard">
          <div className="alert strong bad" data-testid="driver-post-cutoff">
            已过 10:00 装运停止时刻：不再接收/开工任何站点清运指令。请完成下方撤离与交接确认。
          </div>
          {todos.map((t) => (
            <div key={t.id} className="rain-todo">
              <div>
                <b>{t.title}</b>
                <p className="small muted">{t.detail}</p>
              </div>
              <button
                className={`btn small ${t.ack ? '' : 'primary'}`}
                disabled={t.ack}
                onClick={() => dispatch({ type: t.id === 'evac' ? 'ackEvac' : 'ackHandover' })}
              >
                {t.ack ? '✓ 已确认' : '确认'}
              </button>
            </div>
          ))}
        </Panel>
      )}

      {!postCutoff && (!task || task.status === 'replanned') && (
        <Panel title="本轮任务">
          <div className="alert" data-testid="driver-waiting">
            {task?.status === 'replanned'
              ? '原任务已被调度终止/重排：请原地待命，按停收与增援交接要求执行，不要自行前往第二站。'
              : '当前没有已确认的首站任务。请等待调度员发布——本窗口只会收到一个合法可执行站点。'}
          </div>
        </Panel>
      )}

      {!postCutoff && task && task.status !== 'replanned' && st && (
        <Panel
          title={
            <span>
              本窗口确认任务：{st.code} {st.name}
              {task.status === 'done' && <Badge tone="green">已完成</Badge>}
            </span>
          }
          testid="driver-task-card"
        >
          <div className="rain-driver-meta">
            <Badge tone={task.mode === 'auto' ? 'blue' : 'indigo'}>
              {task.mode === 'auto' ? '满溢率准则派单' : '人工改序派单'}
            </Badge>
            <Badge tone="orange">截止 {fmtMin(st.deadlineMin)}</Badge>
            <Badge tone="gray">作业 {st.serviceMin} 分钟</Badge>
          </div>

          <div className="alert">
            <b>估计 {st.estimate.tonLow.toFixed(3)}–{st.estimate.tonHigh.toFixed(2)}t</b>
            （满溢 {st.estimate.fullnessLowPct}%–{st.estimate.fullnessHighPct}%）——
            传感器缺报，这是<b>区间估计，不是实测、不是 0</b>；请以现场扫码称重为准，实称超余量必须停收。
          </div>

          {task.manualReason && (
            <div className="small muted">本单为人工改序，留痕理由：{task.manualReason}</div>
          )}

          <div className="rain-action-stack" data-testid="driver-actions">
            {(st.status === 'tasked' || st.status === 'pending') && (
              <button className="btn primary block" data-testid="btn-arrive" onClick={() => dispatch({ type: 'driverArrive' })}>
                ① 确认到站（现位→{st.code} 行驶 {st.posTravelMin} 分钟，将时钟推进到 {fmtMin(state.nowMin + st.posTravelMin)}）
              </button>
            )}

            {st.status === 'arrived' && (
              <button className="btn primary block" data-testid="btn-scan" onClick={() => dispatch({ type: 'driverScan' })}>
                ② 扫描容器二维码（到站时刻 {fmtMin(state.nowMin)} 不计为完成）
              </button>
            )}

            {st.status === 'scanned' && (
              <div className="rain-weigh" data-testid="weigh-box">
                <label className="small">③ 输入司机端实称吨数并提交（含装载，作业 {st.serviceMin} 分钟）</label>
                <div className="btn-row">
                  <input
                    className="input rain-weigh-input mono"
                    placeholder="例如 0.68"
                    value={weighText}
                    inputMode="decimal"
                    data-testid="weigh-input"
                    onChange={(e) => setWeighText(e.target.value)}
                  />
                  <span>t（当前可用余量 {remainingTon(state.vehicle).toFixed(2)}t）</span>
                </div>
                <div className="btn-row">
                  <button className="btn tiny" onClick={() => setWeighText(st.id === 'R' ? '0.68' : '0.88')}>
                    填入合法实称 {st.id === 'R' ? '0.68' : '0.88'}t
                  </button>
                  <button className="btn tiny bad" data-testid="quick-overload" onClick={() => setWeighText('1.10')}>
                    演示④：填入超限实称 1.10t
                  </button>
                </div>
                <button
                  className="btn primary block"
                  data-testid="btn-weigh-submit"
                  onClick={() => {
                    const ton = Number(weighText);
                    if (!Number.isFinite(ton) || ton <= 0) {
                      alert('请输入大于 0 的实称吨数');
                      return;
                    }
                    dispatch({ type: 'driverWeigh', ton });
                    setWeighText('');
                  }}
                >
                  提交称重并完成装载
                </button>
              </div>
            )}

            {st.status === 'rejected' && (
              <div className="alert strong bad" data-testid="overload-alert">
                <b>⛔ 已停收：</b>
                {st.rejectReason}。载重未增加，{st.code} 未登记完成；已通知调度重排并生成增援。
                请不要强行装载，等待调度指令。
              </div>
            )}

            {st.status === 'completed' && (
              <div className="alert ok-panel" data-testid="completed-alert">
                <b>✓ {st.code} 已于 {fmtMin(st.completedAtMin ?? state.nowMin)} 清运完成</b>
                ，实称 {st.actualTon?.toFixed(3)}t，当前载重 {state.vehicle.loadTon.toFixed(2)}t。
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* U 卸载流程：只有首站完成后出现 */}
      {st?.status === 'completed' && (
        <Panel title="转场 U 卸载（确认卸空才恢复余量）" testid="unload-card">
          {state.node !== 'U' && state.driverPhase === 'done-station' && (
            <button className="btn primary block" data-testid="btn-transit-u" onClick={() => dispatch({ type: 'driverTransitU' })}>
              {st.code}→U 行驶 {st.toUTravelMin} 分钟（到达 {fmtMin(state.nowMin + st.toUTravelMin)}）
            </button>
          )}
          {state.node === 'U' && state.driverPhase !== 'empty-confirmed' && (
            <>
              <div className="alert">
                已到 U。卸前载重仍为 <b>{state.vehicle.loadTon.toFixed(2)}t</b>——卸载尚未确认，余量不恢复。
                本例无排队，卸载作业 {5} 分钟。
              </div>
              <button
                className="btn primary block"
                data-testid="btn-confirm-empty"
                onClick={() => dispatch({ type: 'driverConfirmEmpty' })}
              >
                卸载完成，点击「确认卸空」（时钟 +5 分钟）
              </button>
            </>
          )}
          {state.driverPhase === 'empty-confirmed' && (
            <div className="alert ok-panel" data-testid="empty-confirmed">
              <b>✓ 已确认卸空</b>：当前载重 0.00t，可用余量恢复为 {state.vehicle.capacityTon.toFixed(1)}t。
              {task &&
                (() => {
                  const other = state.stations.find((x) => x.id !== task.stationId);
                  const leg = analysis.projections[`${task.stationId}->${other?.id}`];
                  if (!other || !leg) return null;
                  return (
                    <div className="rain-second-block">
                      但时间硬约束仍在：此刻从 U 去 {other.code}，最早 <b>{fmtMin(leg.secondCompleteMin)}</b> 才完成，
                      晚于 {other.code} 截止 {fmtMin(other.deadlineMin)} 共 <b className="bad">{leg.lateByMin} 分钟</b>
                      （且 10:00 停止装运）。<b>不得前往开工</b>；{other.code} 由增援车辆服务，等待交接指令。
                    </div>
                  );
                })()}
            </div>
          )}
        </Panel>
      )}

      <Panel title="司机端最新留痕">
        <div className="rain-log">
          {state.logs.slice(0, 8).map((l) => (
            <div key={l.id} className={`rain-log-line tone-${l.tone ?? 'info'}`}>
              <span className="mono rain-log-time">{fmtMin(l.atMin)}</span>
              <span>{l.message}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
