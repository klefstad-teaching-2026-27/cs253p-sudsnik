import { SHUTTLES, SHUTTLE_CAPACITY } from "@sudsnik/contracts";
import type { Store } from "./store.js";

export const SHUTTLE_ROTATION = "shuttle";

export interface TripRequest {
  habitatId: string;
  nodeId: string;
  windowStart: number;
}

/**
 * Round-robin over the shuttles, taking the first whose trip at this window is either not yet planned or
 * already flies this habitat-to-node route with room for one more pod. When every shuttle is full or elsewhere, the
 * least loaded one is overbooked rather than leaving the order without a launch. Synchronous; call it inside the
 * transaction that writes the assignment.
 */
export function chooseShuttle(store: Store, req: TripRequest): string {
  const start = store.rotationIndex(SHUTTLE_ROTATION) % SHUTTLES.length;
  let fallback: { shuttleId: string; pods: number } | undefined;
  for (let i = 0; i < SHUTTLES.length; i++) {
    const index = (start + i) % SHUTTLES.length;
    const shuttleId = SHUTTLES[index]!;
    const trip = store.trip(shuttleId, req.windowStart);
    const sameRoute = !trip || (trip.habitat_id === req.habitatId && trip.node_id === req.nodeId);
    if (sameRoute && (trip?.pods ?? 0) < SHUTTLE_CAPACITY) return board(store, shuttleId, index, req);
    const pods = trip?.pods ?? 0;
    if (!fallback || pods < fallback.pods) fallback = { shuttleId, pods };
  }
  const chosen = fallback!;
  return board(store, chosen.shuttleId, SHUTTLES.indexOf(chosen.shuttleId as (typeof SHUTTLES)[number]), req);
}

function board(store: Store, shuttleId: string, index: number, req: TripRequest): string {
  store.addToTrip({ shuttle_id: shuttleId, window_start: req.windowStart, habitat_id: req.habitatId, node_id: req.nodeId });
  store.setRotationIndex(SHUTTLE_ROTATION, (index + 1) % SHUTTLES.length);
  return shuttleId;
}
