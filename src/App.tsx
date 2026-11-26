// 应用入口：默认进入本题「暴雨前 H/R 首轮可执行安排」看板；
// 可切换到原有「封路重排」基线工作台（其 17 个测试与完整流程保持不变）。
import { useEffect, useState } from 'react';
import { RainWorkbench } from './components/rain/RainWorkbench';
import { BaselineShell } from './components/BaselineShell';

type View = 'rain' | 'baseline';

function initialView(): View {
  try {
    if (window.location.hash === '#baseline') return 'baseline';
  } catch {
    /* ignore */
  }
  return 'rain';
}

export default function App() {
  const [view, setView] = useState<View>(initialView);

  useEffect(() => {
    const onHash = () => setView(window.location.hash === '#baseline' ? 'baseline' : 'rain');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  if (view === 'baseline') {
    return (
      <BaselineShell
        onBack={() => {
          window.location.hash = '';
          setView('rain');
        }}
      />
    );
  }
  return <RainWorkbench onOpenBaseline={() => {
    window.location.hash = 'baseline';
    setView('baseline');
  }} />;
}
