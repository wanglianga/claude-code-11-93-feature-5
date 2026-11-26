// 暴雨首轮安排工作台外壳：独立时钟、调度员/司机视角切换、可回到原有封路重排工作台
import { useState } from 'react';
import { RainProvider, useRain } from '../../state/RainContext';
import { NOW_MIN, WEATHER_CUTOFF_MIN, fmtMin } from '../../lib/rainstorm';
import { DispatcherRain } from './DispatcherRain';
import { DriverRain } from './DriverRain';

type RainRole = 'dispatcher' | 'driver';

function RainHeader({
  role,
  setRole,
  onOpenBaseline,
}: {
  role: RainRole;
  setRole: (r: RainRole) => void;
  onOpenBaseline: () => void;
}) {
  const { state, dispatch } = useRain();
  return (
    <header className="topbar rain-topbar">
      <div className="brand">🌧 暴雨抢运 · 首轮可执行安排（H / R / U）</div>
      <div className="clock">
        <span className="mono clock-num" data-testid="rain-clock">
          {fmtMin(state.nowMin)}
        </span>
        <button className="btn tiny" onClick={() => dispatch({ type: 'advance', delta: 1 })}>+1分</button>
        <button className="btn tiny" onClick={() => dispatch({ type: 'advance', delta: 5 })}>+5分</button>
        <button className="btn tiny" onClick={() => dispatch({ type: 'advance', delta: 10 })}>+10分</button>
        <button
          className="btn tiny ghost"
          data-testid="clock-1000"
          onClick={() => dispatch({ type: 'setClockMin', min: WEATHER_CUTOFF_MIN })}
        >
          到 10:00
        </button>
        <button
          className="btn tiny ghost"
          data-testid="clock-0920"
          onClick={() => dispatch({ type: 'setClockMin', min: NOW_MIN })}
        >
          回 09:20
        </button>
      </div>
      <div className="who">
        <div className="rain-role-switch" data-testid="role-switch">
          <button
            className={`btn tiny ${role === 'dispatcher' ? 'primary' : ''}`}
            data-testid="role-dispatcher"
            onClick={() => setRole('dispatcher')}
          >
            调度员台
          </button>
          <button
            className={`btn tiny ${role === 'driver' ? 'primary' : ''}`}
            data-testid="role-driver"
            onClick={() => setRole('driver')}
          >
            司机端
          </button>
        </div>
        <button className="btn tiny ghost" onClick={onOpenBaseline}>
          原封路重排工作台 →
        </button>
      </div>
    </header>
  );
}

function RainShell({ onOpenBaseline }: { onOpenBaseline: () => void }) {
  const [role, setRole] = useState<RainRole>('dispatcher');
  return (
    <div className="app rain-app" data-testid="rain-board">
      <RainHeader role={role} setRole={setRole} onOpenBaseline={onOpenBaseline} />
      <main>
        {role === 'dispatcher' ? <DispatcherRain /> : <DriverRain />}
        <footer className="rain-footer small muted">
          本题看板免登录即可操作；测试账号（原工作台）：调度员 dispatcher/disp123、司机 driver1/drv123、客服
          service/svc123。全部数据为随题虚构数据，本看板状态保存在浏览器 localStorage，「重置现场」即可回放。
        </footer>
      </main>
    </div>
  );
}

export function RainWorkbench({ onOpenBaseline }: { onOpenBaseline: () => void }) {
  return (
    <RainProvider>
      <RainShell onOpenBaseline={onOpenBaseline} />
    </RainProvider>
  );
}
