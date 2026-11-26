// 暴雨看板的小型展示组件
import React from 'react';
import { fmtMin, type TimedStep } from '../../lib/rainstorm';

export function Panel({
  title,
  extra,
  children,
  className = '',
  testid,
}: {
  title?: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testid?: string;
}) {
  return (
    <section className={`panel rain-panel ${className}`} data-testid={testid}>
      {title && (
        <div className="rain-panel-head">
          <h3>{title}</h3>
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}

const TONE_CLASS: Record<string, string> = {
  gray: 'gray',
  blue: 'blue',
  green: 'green',
  red: 'red',
  orange: 'orange',
  indigo: 'indigo',
};

export function Badge({ tone = 'gray', children }: { tone?: keyof typeof TONE_CLASS | string; children: React.ReactNode }) {
  return <span className={`badge ${TONE_CLASS[tone] ?? 'gray'}`}>{children}</span>;
}

export function Timeline({ steps, testid }: { steps: TimedStep[]; testid?: string }) {
  return (
    <ol className="rain-timeline" data-testid={testid}>
      {steps.map((st, i) => (
        <li
          key={i}
          className={st.bad ? 'is-bad' : st.ok ? 'is-ok' : ''}
        >
          <span className="rain-tl-time mono">{fmtMin(st.atMin)}</span>
          <span className="rain-tl-dot" />
          <span className="rain-tl-body">
            <span className="rain-tl-label">{st.label}</span>
            {st.note && <span className="rain-tl-note">{st.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function LoadBar({ load, capacity }: { load: number; capacity: number }) {
  const pct = Math.min(100, Math.round((load / capacity) * 100));
  const over = load > capacity + 1e-9;
  return (
    <div className="loadbar rain-loadbar" title={`${load.toFixed(2)} / ${capacity.toFixed(1)}t`}>
      <div
        className="loadbar-fill"
        style={{ width: `${Math.min(100, pct)}%`, background: over ? '#dc2626' : pct > 80 ? '#ea580c' : '#2563eb' }}
      />
    </div>
  );
}
