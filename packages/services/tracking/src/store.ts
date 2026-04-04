import { fileURLToPath } from "node:url";
import type { Envelope, Handler, ServiceDeps, Topic } from "@sudsnik/contracts";
import type { PodLocation } from "@sudsnik/contracts/services/tracking";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb, type Db } from "@sudsnik/infra-db";
import { ok } from "@sudsnik/kernel";

export const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

export interface StoredPosition {
  shuttleId: string;
  orbitPhase: number;
  observedAt: number;
}
export interface Location extends PodLocation {
  tenantId: string;
}
export interface Move {
  podId: string;
  kind: PodLocation["kind"];
  id: string;
  since: number;
}

interface PositionRow {
  shuttle_id: string;
  orbit_phase: number;
  observed_at: number;
}
interface LocationRow {
  pod_id: string;
  tenant_id: string;
  kind: PodLocation["kind"];
  id: string;
  since: number;
}

export interface Store {
  readonly db: Db;
  /** True the first time `id` is seen in `table`; false on a replay. */
  firstSeen(table: "callbacks" | "handled", id: string): boolean;
  position(shuttleId: string): StoredPosition | undefined;
  positions(): StoredPosition[];
  /** Keeps the newest observation per shuttle; returns whether `p` replaced what was stored. */
  putPosition(p: StoredPosition): boolean;
  location(podId: string): Location | undefined;
  locate(tenantId: string, orderId: string, move: Move): void;
  reject(id: string, body: unknown, at: number): void;
  close(): void;
}

const stores = new WeakMap<ServiceDeps, Store>();

const toPosition = (r: PositionRow): StoredPosition => ({ shuttleId: r.shuttle_id, orbitPhase: r.orbit_phase, observedAt: r.observed_at });

export function openStore(deps: ServiceDeps): Store {
  const db = openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
  const store: Store = {
    db,
    firstSeen: (table, id) => db.write(`insert or ignore into ${table} (id) values (?)`, id).changes === 1,
    position(shuttleId) {
      const r = db.readOne<PositionRow>("select * from positions where shuttle_id = ?", shuttleId);
      return r && toPosition(r);
    },
    positions: () => db.read<PositionRow>("select * from positions order by shuttle_id").map(toPosition),
    putPosition: (p) =>
      db.write(
        "insert into positions (shuttle_id, orbit_phase, observed_at) values (?, ?, ?) on conflict (shuttle_id) do update set orbit_phase = excluded.orbit_phase, observed_at = excluded.observed_at where excluded.observed_at >= positions.observed_at",
        p.shuttleId,
        p.orbitPhase,
        p.observedAt,
      ).changes === 1,
    location(podId) {
      const r = db.readOne<LocationRow>("select * from pod_locations where pod_id = ?", podId);
      return r && { podId: r.pod_id, tenantId: r.tenant_id, kind: r.kind, id: r.id, since: r.since };
    },
    locate(tenantId, orderId, m) {
      // A pod moves forward: an observation older than the stored one is a late redelivery, never news.
      db.write(
        "insert into pod_locations (pod_id, tenant_id, order_id, kind, id, since) values (?, ?, ?, ?, ?, ?) on conflict (pod_id) do update set order_id = excluded.order_id, kind = excluded.kind, id = excluded.id, since = excluded.since where excluded.since >= pod_locations.since",
        m.podId,
        tenantId,
        orderId,
        m.kind,
        m.id,
        m.since,
      );
    },
    reject: (id, body, at) => void db.write("insert or ignore into rejected_callbacks (id, body, rejected_at) values (?, ?, ?)", id, JSON.stringify(body), at),
    close() {
      stores.delete(deps);
      db.close();
    },
  };
  stores.set(deps, store);
  return store;
}

/** The store `createApp` opened on these deps; handlers reach it through the deps the registry hands them. */
export function storeOf(deps: ServiceDeps): Store {
  const s = stores.get(deps);
  if (!s) throw new Error("tracking store is not open");
  return s;
}

/** Pod ids are `<habitatId>-p<NNN>` (canon `podId`). */
export const habitatOf = (podId: string): string => podId.slice(0, podId.lastIndexOf("-p"));

/** A handler that moves a pod once per envelope id; `where` returns nothing when the event moves no pod. */
export function onMove<P extends { orderId: string }>(topic: Topic, where: (e: Envelope<P>) => Move | undefined): Handler<P> {
  return {
    topic,
    async handle(e, deps) {
      const store = storeOf(deps);
      store.db.transaction(() => {
        if (!store.firstSeen("handled", e.id)) return;
        const move = where(e);
        if (move) store.locate(e.tenantId, e.payload.orderId, move);
      });
      return ok(undefined);
    },
  };
}
