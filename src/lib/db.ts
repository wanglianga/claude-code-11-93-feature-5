// IndexedDB 持久层（idb 封装）：全部业务状态落库，可一键重置重放
import { openDB, type IDBPDatabase } from 'idb';
import type {
  Closure, DumpSite, EventLog, NotificationDoc, Receipt, Road, RouteVersion, Station, Vehicle,
} from '../types';
import * as seed from './seed';

const DB_NAME = 'sanitation-workbench';
const DB_VERSION = 1;

export interface Snapshot {
  nowMin: number;
  vehicles: Vehicle[];
  stations: Station[];
  roads: Road[];
  closures: Closure[];
  dumps: DumpSite[];
  notifications: NotificationDoc[];
  routeVersions: RouteVersion[];
  receipts: Receipt[];
  outbox: Receipt[];
  events: EventLog[];
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('meta');
        db.createObjectStore('vehicles', { keyPath: 'id' });
        db.createObjectStore('stations', { keyPath: 'id' });
        db.createObjectStore('roads', { keyPath: 'id' });
        db.createObjectStore('closures', { keyPath: 'id' });
        db.createObjectStore('dumps', { keyPath: 'id' });
        db.createObjectStore('notifications', { keyPath: 'id' });
        db.createObjectStore('routeVersions', { keyPath: 'id' });
        db.createObjectStore('receipts', { keyPath: 'id' });
        db.createObjectStore('outbox', { keyPath: 'id' });
        db.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      },
    });
  }
  return dbPromise;
}

export async function loadSnapshot(): Promise<Snapshot> {
  const db = await getDb();
  const [nowMin, vehicles, stations, roads, closures, dumps, notifications, routeVersions, receipts, outbox, events] =
    await Promise.all([
      db.get('meta', 'nowMin'),
      db.getAll('vehicles'),
      db.getAll('stations'),
      db.getAll('roads'),
      db.getAll('closures'),
      db.getAll('dumps'),
      db.getAll('notifications'),
      db.getAll('routeVersions'),
      db.getAll('receipts'),
      db.getAll('outbox'),
      db.getAll('events'),
    ]);
  return {
    nowMin: nowMin ?? seed.START_MIN,
    vehicles, stations, roads, closures, dumps, notifications, routeVersions, receipts, outbox,
    events: (events as EventLog[]).sort((a, b) => (a.id ?? 0) - (b.id ?? 0)),
  };
}

/** 重置并重放：清空全部仓库，写入随题固定的虚构数据。 */
export async function resetAndSeed(): Promise<void> {
  const db = await getDb();
  const stores = [
    'meta', 'vehicles', 'stations', 'roads', 'closures', 'dumps',
    'notifications', 'routeVersions', 'receipts', 'outbox', 'events',
  ];
  const tx = db.transaction(stores, 'readwrite');
  for (const s of stores) await tx.objectStore(s).clear();
  await tx.objectStore('meta').put(seed.START_MIN, 'nowMin');
  for (const v of seed.VEHICLES) await tx.objectStore('vehicles').put(v);
  for (const s of seed.STATIONS) await tx.objectStore('stations').put(s);
  for (const r of seed.ROADS) await tx.objectStore('roads').put(r);
  for (const c of seed.CLOSURES) await tx.objectStore('closures').put(c);
  for (const d of seed.DUMPS) await tx.objectStore('dumps').put(d);
  for (const n of seed.NOTIFICATIONS) await tx.objectStore('notifications').put(n);
  for (const rv of seed.ROUTE_VERSIONS) await tx.objectStore('routeVersions').put(rv);
  for (const e of seed.SEED_EVENTS) await tx.objectStore('events').add(e);
  await tx.done;
}

export async function isSeeded(): Promise<boolean> {
  const db = await getDb();
  const count = await db.count('vehicles');
  return count > 0;
}
