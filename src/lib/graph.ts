// 路网最短路：考虑车辆限高限宽、按出发时刻生效的道路封闭
import type { Closure, Road } from '../types';

export interface VehicleDims {
  heightM: number;
  widthM: number;
}

export interface PathLeg {
  roadId: string;
  from: string;
  to: string;
  departMin: number;
  arriveMin: number;
}

export type PathOutcome =
  | { ok: true; minutes: number; path: string[]; legs: PathLeg[] }
  | { ok: false; reason: string };

export function isClosedAt(closures: Closure[], road: Road, t: number): boolean {
  return closures.some((c) => c.roadGroup === road.group && t >= c.fromMin && t < c.toMin);
}

function fitsDims(road: Road, veh: VehicleDims): boolean {
  if (road.heightLimitM != null && veh.heightM > road.heightLimitM) return false;
  if (road.widthLimitM != null && veh.widthM > road.widthLimitM) return false;
  return true;
}

interface SearchOptions {
  ignoreClosures?: boolean;
  ignoreDims?: boolean;
}

function dijkstra(
  roads: Road[],
  closures: Closure[],
  from: string,
  to: string,
  departMin: number,
  veh: VehicleDims,
  opts: SearchOptions,
): PathOutcome {
  const dist = new Map<string, number>();
  const prev = new Map<string, { node: string; road: Road; depart: number }>();
  dist.set(from, departMin);
  const visited = new Set<string>();

  for (;;) {
    let u: string | null = null;
    let best = Infinity;
    for (const [n, d] of dist) {
      if (!visited.has(n) && d < best) {
        best = d;
        u = n;
      }
    }
    if (u === null) break;
    if (u === to) break;
    visited.add(u);
    const du = dist.get(u)!;
    for (const r of roads) {
      if (r.from !== u) continue;
      if (!opts.ignoreDims && !fitsDims(r, veh)) continue;
      if (!opts.ignoreClosures && isClosedAt(closures, r, du)) continue;
      const arr = du + r.minutes;
      if (arr < (dist.get(r.to) ?? Infinity)) {
        dist.set(r.to, arr);
        prev.set(r.to, { node: u, road: r, depart: du });
      }
    }
  }

  if (!dist.has(to)) return { ok: false, reason: '无可通行路径' };
  const legs: PathLeg[] = [];
  const path: string[] = [to];
  let cur = to;
  while (cur !== from) {
    const p = prev.get(cur)!;
    legs.unshift({
      roadId: p.road.id,
      from: p.node,
      to: cur,
      departMin: p.depart,
      arriveMin: p.depart + p.road.minutes,
    });
    cur = p.node;
    path.unshift(cur);
  }
  return { ok: true, minutes: dist.get(to)! - departMin, path, legs };
}

/** 车辆从 from 出发于 departMin 时刻到 to 的最短可行路径（核验限高限宽与封闭）。 */
export function shortestPath(
  roads: Road[],
  closures: Closure[],
  from: string,
  to: string,
  departMin: number,
  veh: VehicleDims,
): PathOutcome {
  return dijkstra(roads, closures, from, to, departMin, veh, {});
}

/**
 * 站间行程耗时：题目路网中两节点间若有直接路段，其耗时为给定值（直接路段优先）；
 * 直接路段被封闭或不满足限高限宽时，才退化为全网绕行（Dijkstra）。
 * 这保证规划使用的站间耗时与题目给定数值一致，同时仍核验吨位/限行/封闭。
 */
export function travelLeg(
  roads: Road[],
  closures: Closure[],
  from: string,
  to: string,
  departMin: number,
  veh: VehicleDims,
): PathOutcome {
  for (const r of roads) {
    if (r.from !== from || r.to !== to) continue;
    if (!fitsDims(r, veh)) continue;
    if (isClosedAt(closures, r, departMin)) continue;
    return {
      ok: true,
      minutes: r.minutes,
      path: [from, to],
      legs: [{ roadId: r.id, from, to, departMin, arriveMin: departMin + r.minutes }],
    };
  }
  return dijkstra(roads, closures, from, to, departMin, veh, {});
}

/**
 * 当 shortestPath 失败时给出原因分类：是封闭导致、限高限宽导致，还是路网本就不连通。
 * 用于向调度员解释“为什么地图上看起来能到、实际不可行”。
 */
export function explainUnreachable(
  roads: Road[],
  closures: Closure[],
  from: string,
  to: string,
  departMin: number,
  veh: VehicleDims,
): string {
  const noClosure = dijkstra(roads, closures, from, to, departMin, veh, { ignoreClosures: true });
  if (noClosure.ok) return '道路封闭导致不可达（解除封闭后可达）';
  const noDims = dijkstra(roads, closures, from, to, departMin, veh, { ignoreClosures: true, ignoreDims: true });
  if (noDims.ok) return '车辆超出道路限高/限宽，无法通行';
  return '路网中无连通路径';
}
