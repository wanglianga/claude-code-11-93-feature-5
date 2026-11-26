// SVG 示意地图：路网、限行、封闭、车辆位置与当前线路
import React, { useMemo } from 'react';
import type { Snapshot } from '../lib/db';
import { NODES } from '../lib/seed';
import { computeRouteEvals } from '../lib/actions';
import { fmtMin, type NodeDef, type Road } from '../types';
import { VEHICLE_COLORS } from './Shared';

const NODE_MAP = new Map(NODES.map((n) => [n.id, n]));

function node(id: string): NodeDef {
  return NODE_MAP.get(id)!;
}

interface Curve { d: string; mx: number; my: number; }

function curveFor(a: NodeDef, b: NodeDef, bend: number): Curve {
  const mx0 = (a.x + b.x) / 2;
  const my0 = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * bend;
  const ny = (dx / len) * bend;
  const cx = mx0 + nx;
  const cy = my0 + ny;
  return {
    d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
    mx: (a.x + 2 * cx + b.x) / 4,
    my: (a.y + 2 * cy + b.y) / 4,
  };
}

const STATUS_FILL: Record<string, string> = {
  pending: '#94a3b8',
  arrived: '#3b82f6',
  scanned: '#6366f1',
  completed: '#22c55e',
  rejected: '#ef4444',
};

export function MapView({ snap }: { snap: Snapshot }) {
  const routeEvals = useMemo(() => computeRouteEvals(snap), [snap]);

  // 判断一对反向边，给每条边一个弯曲方向，避免重叠
  const pairCount = new Map<string, number>();
  for (const r of snap.roads) {
    const key = [r.from, r.to].sort().join('|');
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }

  const closedGroups = new Map(snap.closures.map((c) => [c.roadGroup, c]));

  return (
    <div className="panel map-panel">
      <h3>路网地图（含限行 / 封闭 / 车辆与当前线路）</h3>
      <svg viewBox="0 0 820 520" className="map-svg">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
          </marker>
        </defs>

        {/* 道路 */}
        {snap.roads.map((r: Road) => {
          const a = node(r.from);
          const b = node(r.to);
          const paired = (pairCount.get([r.from, r.to].sort().join('|')) ?? 0) > 1;
          const bend = paired ? 14 : 0;
          const c = curveFor(a, b, bend);
          const closed = closedGroups.has(r.group);
          const limit = [
            r.heightLimitM != null ? `限高${r.heightLimitM}m` : '',
            r.widthLimitM != null ? `限宽${r.widthLimitM}m` : '',
          ].filter(Boolean).join(' ');
          return (
            <g key={r.id}>
              <path d={c.d} fill="none" stroke={closed ? '#ef4444' : '#cbd5e1'} strokeWidth={closed ? 3 : 1.5}
                strokeDasharray={closed ? '6 4' : undefined} markerEnd="url(#arrow)" />
              <text x={c.mx} y={c.my - 3} fontSize="9" textAnchor="middle" fill={closed ? '#dc2626' : '#64748b'}>
                {r.minutes}分{limit ? ` ${limit}` : ''}
              </text>
            </g>
          );
        })}

        {/* 封闭标注 */}
        {snap.closures.map((cl) => {
          const road = snap.roads.find((r) => r.group === cl.roadGroup);
          if (!road) return null;
          const a = node(road.from);
          const b = node(road.to);
          const c = curveFor(a, b, 0);
          return (
            <text key={cl.id} x={c.mx} y={c.my - 12} fontSize="11" textAnchor="middle" fill="#dc2626" fontWeight="700">
              ⛔ {cl.label}封闭 {fmtMin(cl.fromMin)}–{fmtMin(cl.toMin)}
            </text>
          );
        })}

        {/* 当前线路（按车辆着色） */}
        {[...routeEvals.entries()].map(([vid, ev]) => {
          const color = VEHICLE_COLORS[vid] ?? '#666';
          const pts: string[] = [];
          let cur = snap.vehicles.find((v) => v.id === vid)?.posNodeId;
          for (const leg of ev.legs) {
            leg.path.forEach((nid, i) => {
              if (pts.length > 0 && i === 0) return;
              const n = node(nid);
              pts.push(`${n.x},${n.y}`);
            });
            cur = leg.path[leg.path.length - 1];
          }
          if (pts.length < 2) return null;
          return (
            <polyline key={vid} points={pts.join(' ')} fill="none" stroke={color}
              strokeWidth="3.5" strokeOpacity="0.55" strokeLinejoin="round" strokeDasharray="1 0" />
          );
        })}

        {/* 节点 */}
        {NODES.map((n) => {
          if (n.kind === 'station') {
            const st = snap.stations.find((s) => s.id === n.id)!;
            return (
              <g key={n.id}>
                <circle cx={n.x} cy={n.y} r="14" fill={STATUS_FILL[st.status]} stroke="#fff" strokeWidth="2" />
                <text x={n.x} y={n.y + 4} fontSize="11" textAnchor="middle" fill="#fff" fontWeight="700">{n.id}</text>
                <text x={n.x} y={n.y + 30} fontSize="10" textAnchor="middle" fill="#0f172a" fontWeight="600">{st.name}</text>
                <text x={n.x} y={n.y + 42} fontSize="9" textAnchor="middle" fill="#64748b">
                  估{st.estTon}t{st.actualTon != null ? ` 实${st.actualTon}t` : ''} · 止{fmtMin(st.deadlineMin)}
                </text>
                {st.overflowReported && (
                  <text x={n.x + 12} y={n.y - 12} fontSize="11">🗑️</text>
                )}
              </g>
            );
          }
          if (n.kind === 'dump') {
            const d = snap.dumps.find((x) => x.nodeId === n.id)!;
            return (
              <g key={n.id}>
                <rect x={n.x - 13} y={n.y - 13} width="26" height="26" rx="4" fill="#a16207" stroke="#fff" strokeWidth="2" />
                <text x={n.x} y={n.y + 4} fontSize="10" textAnchor="middle" fill="#fff" fontWeight="700">{n.id}</text>
                <text x={n.x} y={n.y + 30} fontSize="10" textAnchor="middle" fill="#0f172a" fontWeight="600">{d.name}</text>
                <text x={n.x} y={n.y + 42} fontSize="9" textAnchor="middle" fill="#64748b">
                  开放 {d.windows.map((w) => `${fmtMin(w.startMin)}–${fmtMin(w.endMin)}`).join(' ')}
                </text>
              </g>
            );
          }
          return (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={n.kind === 'depot' ? 8 : 4} fill={n.kind === 'depot' ? '#475569' : '#94a3b8'} />
              <text x={n.x} y={n.y + 18} fontSize="9" textAnchor="middle" fill="#64748b">{n.name}</text>
            </g>
          );
        })}

        {/* 车辆 */}
        {snap.vehicles.map((v) => {
          const n = node(v.posNodeId);
          const color = VEHICLE_COLORS[v.id] ?? '#666';
          return (
            <g key={v.id}>
              <rect x={n.x - 34} y={n.y - 34} width="44" height="20" rx="4" fill={color} stroke="#fff" strokeWidth="1.5" />
              <text x={n.x - 12} y={n.y - 20} fontSize="11" textAnchor="middle" fill="#fff" fontWeight="700">🚛{v.id}</text>
              <text x={n.x - 12} y={n.y - 38} fontSize="9" textAnchor="middle" fill={color} fontWeight="700">
                {v.loadTon.toFixed(1)}/{v.capacityTon.toFixed(1)}t
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        <span><i className="dot" style={{ background: '#94a3b8' }} />待服务</span>
        <span><i className="dot" style={{ background: '#22c55e' }} />已完成</span>
        <span><i className="dot" style={{ background: '#ef4444' }} />拒收/封闭</span>
        <span><i className="dot" style={{ background: VEHICLE_COLORS.T1 }} />T1 线路</span>
        <span><i className="dot" style={{ background: VEHICLE_COLORS.T2 }} />T2 线路</span>
        <span>边标注：行驶分钟 · 限高/限宽</span>
      </div>
    </div>
  );
}
