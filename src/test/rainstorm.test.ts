// 本题（93-feature-5）核心数值与硬约束测试：
// 暴雨前 H/R 两站首轮安排 —— 题目给出的每一个关键时刻都在此钉死。
import { describe, expect, it } from 'vitest';
import {
  CHOSEN_POLICY,
  NOW_MIN,
  WEATHER_CUTOFF_MIN,
  analyzeRain,
  checkPublish,
  evalSecondLeg,
  evalUnloadAndReturn,
  fmtMin,
  initialRainState,
  offBoardTodos,
  rainReducer,
  rankByServiceLevel,
  taskInvalidReasons,
} from '../lib/rainstorm';

describe('种子现场与区间来源', () => {
  it('09:20 开始，10:00 天气窗口截止；选定准则为满溢率上界优先', () => {
    const s = initialRainState();
    expect(s.nowMin).toBe(560);
    expect(NOW_MIN).toBe(560);
    expect(WEATHER_CUTOFF_MIN).toBe(600);
    expect(fmtMin(s.nowMin)).toBe('09:20');
    expect(fmtMin(WEATHER_CUTOFF_MIN)).toBe('10:00');
    expect(CHOSEN_POLICY).toBe('fullness-upper');
  });

  it('车辆可用余量恰为 1.0t（额定 2.0 / 在载 1.0）', () => {
    const s = initialRainState();
    expect(s.vehicle.capacityTon - s.vehicle.loadTon).toBeCloseTo(1.0, 5);
  });

  it('H/R 估计区间与题目完全一致，且均为传感器缺报、不得为 0 或实测', () => {
    const s = initialRainState();
    const H = s.stations.find((x) => x.id === 'H')!;
    const R = s.stations.find((x) => x.id === 'R')!;

    expect(H.containerCapTon).toBe(1.0);
    expect([H.estimate.tonLow, H.estimate.tonHigh]).toEqual([0.8, 0.95]);
    expect([H.estimate.fullnessLowPct, H.estimate.fullnessHighPct]).toEqual([80, 95]);
    expect(H.deadlineMin).toBe(600);

    expect(R.containerCapTon).toBe(0.7);
    expect(R.estimate.tonLow).toBeCloseTo(0.665, 6);
    expect(R.estimate.tonHigh).toBe(0.7);
    expect([R.estimate.fullnessLowPct, R.estimate.fullnessHighPct]).toEqual([95, 100]);
    expect(R.deadlineMin).toBe(590); // 09:50

    for (const st of [H, R]) {
      expect(st.sensor.reportingNow).toBe(false);
      expect(st.estimate.tonLow).toBeGreaterThan(0); // 不能填零
      expect(st.sensor.sourceSummary).toContain('缺报');
      expect(st.sensor.sourceSummary).toContain('前一日实称');
      expect(st.sensor.sourceSummary).toContain('最近一次有效读数');
      expect(st.sensor.sourceSummary).toContain('不是'); // 明确不是实测
    }
  });
});

describe('排序准则', () => {
  it('满溢率上界：R 100% 高于 H 95%，吨位上界不参与排序', () => {
    const s = initialRainState();
    const a = analyzeRain(s);
    expect(a.rows.map((r) => r.st.code)).toEqual(['R', 'H']);
    expect(a.suggestedFirstId).toBe('R');
    // 吨位上界 H(0.95) > R(0.70)，若错用吨位会得到相反顺序
    expect(s.stations.find((x) => x.id === 'H')!.estimate.tonHigh).toBeGreaterThan(
      s.stations.find((x) => x.id === 'R')!.estimate.tonHigh,
    );
  });

  it('另一准则（服务等级优先）：H 先，同等级再比满溢率，稳定站号兜底', () => {
    const s = initialRainState();
    const a = analyzeRain(s);
    expect(rankByServiceLevel(a.rows).map((r) => r.st.code)).toEqual(['H', 'R']);
    expect(a.levelOrder.map((r) => r.st.code)).toEqual(['H', 'R']);
  });
});

describe('首站时刻推演（题目钉死 09:36 与 09:40）', () => {
  it('R 先：09:20 出发 → 09:28 到 → 09:36 完成，合法', () => {
    const s = initialRainState();
    const R = s.stations.find((x) => x.id === 'R')!;
    const a = analyzeRain(s);
    const ev = a.rows.find((r) => r.st.id === 'R')!.first;
    expect(ev.arriveMin).toBe(568);
    expect(ev.completeMin).toBe(576);
    expect(fmtMin(ev.arriveMin)).toBe('09:28');
    expect(fmtMin(ev.completeMin)).toBe('09:36');
    expect(ev.timeOk).toBe(true); // 早于 R 截止 09:50
    expect(ev.capacityOk).toBe(true); // 上界 0.70 ≤ 余量 1.0
    expect(ev.feasible).toBe(true);
  });

  it('H 先：09:32 到 → 09:40 完成，合法（恰早于 10:00）', () => {
    const s = initialRainState();
    const H = s.stations.find((x) => x.id === 'H')!;
    const ev = analyzeRain(s).rows.find((r) => r.st.id === 'H')!.first;
    expect(ev.arriveMin).toBe(572);
    expect(ev.completeMin).toBe(580);
    expect(fmtMin(ev.completeMin)).toBe('09:40');
    expect(ev.timeOk).toBe(true);
    expect(ev.capacityOk).toBe(true); // 上界 0.95 ≤ 1.0
  });

  it('恰在截止时刻完成算合规（边界 <=）', () => {
    const s = initialRainState();
    const H = { ...s.stations.find((x) => x.id === 'H')!, deadlineMin: 580 };
    const ev = analyzeRain({ ...s, stations: [H] }).rows[0].first;
    expect(ev.completeMin).toBe(580);
    expect(ev.timeOk).toBe(true);
    expect(ev.feasible).toBe(true);
  });
});

describe('二站必须 U 卸空且必然失约（10:09 / 10:13，晚 9 / 23 分钟）', () => {
  it('两站估计最低合量 1.465t > 余量 1.0t，必须卸空', () => {
    const s = initialRainState();
    const H = s.stations.find((x) => x.id === 'H')!;
    const R = s.stations.find((x) => x.id === 'R')!;
    const leg = evalSecondLeg(R, H, s.vehicle, s.nowMin);
    expect(leg.minCombinedTon).toBeCloseTo(1.465, 6);
    expect(leg.mustUnload).toBe(true);
  });

  it('R 先 → U → H：H 最早 10:09 完成，晚于 H 截止 9 分钟', () => {
    const s = initialRainState();
    const a = analyzeRain(s);
    const leg = a.projections['R->H'];
    expect(leg.firstCompleteMin).toBe(576);
    expect(leg.arriveUMin).toBe(586); // 09:46
    expect(leg.emptyConfirmedMin).toBe(591); // 09:51
    expect(leg.arriveSecondMin).toBe(601); // 10:01
    expect(leg.secondCompleteMin).toBe(609); // 10:09
    expect(fmtMin(leg.secondCompleteMin)).toBe('10:09');
    expect(leg.lateByMin).toBe(9);
    expect(leg.feasible).toBe(false);
  });

  it('H 先 → U → R：R 最早 10:13 完成，晚于 R 截止 23 分钟', () => {
    const s = initialRainState();
    const leg = analyzeRain(s).projections['H->R'];
    expect(leg.firstCompleteMin).toBe(580);
    expect(leg.emptyConfirmedMin).toBe(595);
    expect(leg.secondCompleteMin).toBe(613); // 10:13
    expect(fmtMin(leg.secondCompleteMin)).toBe('10:13');
    expect(leg.lateByMin).toBe(23);
    expect(leg.feasible).toBe(false);
  });

  it('自动建议 R 时，H 生成待增援 + 预计失约 9 分钟，且不产生可执行二站任务', () => {
    const s = initialRainState();
    const a = analyzeRain(s);
    expect(a.suggestedFirstId).toBe('R');
    const hReinforce = a.reinforcements.find((r) => r.stationId === 'H')!;
    expect(hReinforce.kind).toBe('second-leg-miss');
    expect(hReinforce.lateByMin).toBe(9);
    expect(hReinforce.detail).toContain('10:09');
    expect(hReinforce.appointmentRisk).toContain('预计失约');
    // R 是首站，不应再被列为增援
    expect(a.reinforcements.find((r) => r.stationId === 'R')).toBeUndefined();
  });
});

describe('确认前核对与人工改序', () => {
  it('未核对窗口/估计时禁止发布', () => {
    const s = initialRainState();
    const c = checkPublish(s);
    expect(c.ok).toBe(false);
    expect(c.blockers.join()).toContain('窗口');
    expect(c.blockers.join()).toContain('估计');
  });

  it('勾选两项核对后可发布自动建议 R，任务仅含 R 一站', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    const c = checkPublish(s);
    expect(c.ok).toBe(true);
    expect(c.chosenId).toBe('R');
    s = rainReducer(s, { type: 'publish' });
    expect(s.task?.stationId).toBe('R');
    expect(s.task?.mode).toBe('auto');
    expect(s.stations.find((x) => x.id === 'R')!.status).toBe('tasked');
    expect(s.stations.find((x) => x.id === 'H')!.status).toBe('pending'); // 不提前登记
  });

  it('人工改选 H 但不填理由 → 拦截；填理由后重新验证合法 → 可发布', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    s = rainReducer(s, { type: 'chooseManual', stationId: 'H' });
    expect(checkPublish(s).ok).toBe(false);
    expect(checkPublish(s).blockers.join()).toContain('理由');

    s = rainReducer(s, { type: 'setManualReason', reason: '医院敏感等级优先，先保障院感风险' });
    const c = checkPublish(s);
    expect(c.ok).toBe(true);
    expect(c.chosenId).toBe('H');
    s = rainReducer(s, { type: 'publish' });
    expect(s.task?.mode).toBe('manual');
    expect(s.task?.manualReason).toContain('医院');
    expect(s.task?.stationId).toBe('H');
  });
});

describe('演示变异①：H 估计更新为超过 1 吨', () => {
  it('H 容量硬约束失效，建议保持/回到 R，H 转为硬阻塞增援', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'demoHOver' });
    const H = s.stations.find((x) => x.id === 'H')!;
    expect(H.estimate.tonLow).toBe(1.05);
    expect(H.estimate.tonHigh).toBe(1.2);
    const a = analyzeRain(s);
    const hRow = a.rows.find((r) => r.st.id === 'H')!;
    expect(hRow.first.capacityOk).toBe(false);
    expect(hRow.first.feasible).toBe(false);
    expect(hRow.first.capacityOverTon).toBeCloseTo(0.2, 5);
    expect(a.suggestedFirstId).toBe('R');
    expect(a.reinforcements.find((r) => r.stationId === 'H')!.kind).toBe('hard-block');
  });

  it('已发布任务在修订后立即判定建议失效（basisRev 变化）', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    s = rainReducer(s, { type: 'publish' });
    expect(taskInvalidReasons(s)).toHaveLength(0);
    s = rainReducer(s, { type: 'demoHOver' });
    expect(taskInvalidReasons(s).join()).toContain('修订');
  });

  it('H 超吨后，人工强行选 H 也不能发布（不能越过硬约束）', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'demoHOver' });
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    s = rainReducer(s, { type: 'chooseManual', stationId: 'H' });
    s = rainReducer(s, { type: 'setManualReason', reason: '就是要先去医院' });
    const c = checkPublish(s);
    expect(c.ok).toBe(false);
    expect(c.blockers.join()).toContain('硬约束');
  });
});

describe('演示变异②：R 截止提前到 09:30', () => {
  it('R 最早 09:36 完成 → 时间硬约束失效（晚 6 分），建议改 H', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'demoRDeadlineEarly' });
    const a = analyzeRain(s);
    const r = a.rows.find((x) => x.st.id === 'R')!.first;
    expect(r.completeMin).toBe(576);
    expect(r.timeOk).toBe(false);
    expect(r.lateByMin).toBe(6); // 576 - 570
    expect(r.violations[0].message).toContain('09:36');
    expect(a.suggestedFirstId).toBe('H'); // 排序最高但不合法，硬约束优先
    const rr = a.reinforcements.find((x) => x.stationId === 'R')!;
    expect(rr.kind).toBe('hard-block');
    expect(rr.detail).toContain('09:36');
  });
});

describe('演示变异③：缺报补齐，但报文采样时间更早', () => {
  it('迟到/乱序补报被标记 stale，区间不变，依据版本递增要求重新核对', () => {
    let s = initialRainState();
    const rev0 = s.basisRev;
    s = rainReducer(s, { type: 'demoBackfillEarlier' });
    expect(s.basisRev).toBe(rev0 + 1);
    const H = s.stations.find((x) => x.id === 'H')!;
    const bf = H.sensor.readings.find((r) => r.kind === 'backfill-late')!;
    expect(bf.sampleAtMin).toBe(8 * 60 + 15);
    expect(bf.stale).toBe(true);
    expect(bf.sampleAtMin).toBeLessThan(H.sensor.lastValidSampleAtMin);
    // 估计区间不被旧报文改写
    expect([H.estimate.tonLow, H.estimate.tonHigh]).toEqual([0.8, 0.95]);
    // 之前的确认勾选因 rev 变化而失效
    s = rainReducer(s, { type: 'ackWindow' }); // 只勾窗口
    expect(checkPublish(s).ok).toBe(false);
    expect(checkPublish(s).blockers.join()).toContain('估计');
  });
});

describe('司机执行：合法称重、卸空才恢复余量', () => {
  function publishedR() {
    let s = initialRainState();
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    s = rainReducer(s, { type: 'publish' });
    return s;
  }

  it('R 正常 0.68t：到站 09:28、完成 09:36，载重 1.68t', () => {
    let s = publishedR();
    s = rainReducer(s, { type: 'driverArrive' });
    expect(s.nowMin).toBe(568);
    expect(s.stations.find((x) => x.id === 'R')!.status).toBe('arrived');
    s = rainReducer(s, { type: 'driverScan' });
    s = rainReducer(s, { type: 'driverWeigh', ton: 0.68 });
    expect(s.nowMin).toBe(576);
    const R = s.stations.find((x) => x.id === 'R')!;
    expect(R.status).toBe('completed');
    expect(R.actualTon).toBeCloseTo(0.68, 5);
    expect(R.completedAtMin).toBe(576);
    expect(s.vehicle.loadTon).toBeCloseTo(1.68, 5);
  });

  it('计划/转场到 U 不释放载重；只有“确认卸空”后余量恢复为 2.0t', () => {
    let s = publishedR();
    s = rainReducer(s, { type: 'driverArrive' });
    s = rainReducer(s, { type: 'driverScan' });
    s = rainReducer(s, { type: 'driverWeigh', ton: 0.68 });
    s = rainReducer(s, { type: 'driverTransitU' });
    expect(s.nowMin).toBe(586);
    expect(s.node).toBe('U');
    expect(s.vehicle.loadTon).toBeCloseTo(1.68, 5); // 仍未释放
    s = rainReducer(s, { type: 'driverConfirmEmpty' });
    expect(s.nowMin).toBe(591);
    expect(s.vehicle.loadTon).toBe(0);
    expect(s.vehicle.capacityTon - s.vehicle.loadTon).toBe(2.0); // 卸空恢复全额
  });
});

describe('演示变异④：确认后司机实称超限 → 停收/重排/仍待服务', () => {
  it('R 实称 1.10t > 余量 1.0t：拒收、载重不增、任务失效、R 仍待服务', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    s = rainReducer(s, { type: 'publish' });
    s = rainReducer(s, { type: 'driverArrive' }); // 09:28
    s = rainReducer(s, { type: 'driverScan' });
    s = rainReducer(s, { type: 'driverWeigh', ton: 1.1 });

    const R = s.stations.find((x) => x.id === 'R')!;
    expect(R.status).toBe('rejected');
    expect(R.actualTon).toBeCloseTo(1.1, 5);
    expect(s.vehicle.loadTon).toBeCloseTo(1.0, 5); // 载重不增加
    expect(taskInvalidReasons(s).join()).toContain('实称超限');

    const a = analyzeRain(s);
    const item = a.reinforcements.find((r) => r.stationId === 'R')!;
    expect(item.kind).toBe('actual-overload');
    expect(a.pendingServiceIds).toContain('R'); // 仍待服务
    expect(a.pendingServiceIds).toContain('H');

    // 本车卸空折返最早 10:01（09:28 + 33），仍不及 09:50 / 10:00
    const back = evalUnloadAndReturn(R, s.vehicle, s.nowMin);
    expect(back.completeMin).toBe(601);
    expect(back.lateVsStationMin).toBe(11);
    expect(back.feasible).toBe(false);
  });

  it('调度重排后原任务终止并留下重排日志/计数', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    s = rainReducer(s, { type: 'publish' });
    s = rainReducer(s, { type: 'driverArrive' });
    s = rainReducer(s, { type: 'driverScan' });
    s = rainReducer(s, { type: 'driverWeigh', ton: 1.1 });
    s = rainReducer(s, { type: 'dispatcherReplan' });
    expect(s.replanCount).toBe(1);
    expect(s.task?.status).toBe('replanned');
  });
});

describe('10:00 后：停止开工，只保留撤离与交接', () => {
  it('未完成状态推进到 10:00：禁止发布，生成撤离+交接待办，交接含全部未服务站', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'setClockMin', min: 600 });
    expect(analyzeRain(s).postCutoff).toBe(true);
    expect(checkPublish(s).ok).toBe(false);
    expect(checkPublish(s).blockers.join()).toContain('10:00');

    const todos = offBoardTodos(s);
    expect(todos.map((t) => t.id)).toEqual(['evac', 'handover']);
    expect(todos[1].detail).toContain('H');
    expect(todos[1].detail).toContain('R');

    // 即便勾对核对项，也不能发布
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    expect(checkPublish(s).ok).toBe(false);
  });

  it('10:00 后司机到站动作被拒绝且时钟不前进', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'ackWindow' });
    s = rainReducer(s, { type: 'ackEstimate' });
    s = rainReducer(s, { type: 'publish' });
    s = rainReducer(s, { type: 'setClockMin', min: 600 });
    const before = s.nowMin;
    s = rainReducer(s, { type: 'driverArrive' });
    expect(s.nowMin).toBe(before);
    expect(s.stations.find((x) => x.id === 'R')!.status).toBe('tasked');
  });

  it('交接确认后待办变为已确认', () => {
    let s = initialRainState();
    s = rainReducer(s, { type: 'setClockMin', min: 600 });
    s = rainReducer(s, { type: 'ackEvac' });
    s = rainReducer(s, { type: 'ackHandover' });
    const todos = offBoardTodos(s);
    expect(todos.every((t) => t.ack)).toBe(true);
  });
});
