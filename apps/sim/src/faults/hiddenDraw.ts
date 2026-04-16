import type { FaultEvent } from "@sudsnik/contracts";
import { Rng, subSeed } from "@sudsnik/kernel";

export const STORM_HIDDEN_COMPONENT = "storm-hidden";
export const STORM_PLACEMENT_ORBITS = 12;
const MIN_PICKS = 3;
const MAX_PICKS = 5;
/** Every hidden fault starts at or after this orbit so the stack has a quiet baseline to detect against. */
const EARLIEST_ORBIT = 2;
const LATEST_ORBIT = STORM_PLACEMENT_ORBITS - 2;

export const STORM_CANDIDATES = ["relay-duplicates", "relay-reorder", "relay-bitflip", "node-c-dark-twice", "identity-burst"] as const;
export type StormCandidate = (typeof STORM_CANDIDATES)[number];

function orbitBetween(rng: Rng, lo: number, hi: number): number {
  return lo + rng.int(hi - lo + 1);
}

function eventsFor(candidate: StormCandidate, rng: Rng): FaultEvent[] {
  switch (candidate) {
    case "relay-duplicates":
      return [{ atOrbit: orbitBetween(rng, EARLIEST_ORBIT, LATEST_ORBIT), mock: "relay", kind: "duplicate-rate", params: { rate: 0.2 } }];
    case "relay-reorder":
      return [{ atOrbit: orbitBetween(rng, EARLIEST_ORBIT, LATEST_ORBIT), mock: "relay", kind: "reorder-rate", params: { rate: 0.3 } }];
    case "relay-bitflip":
      return [{ atOrbit: orbitBetween(rng, EARLIEST_ORBIT, LATEST_ORBIT), mock: "relay", kind: "bitflip-rate", params: { rate: 0.02 } }];
    case "node-c-dark-twice": {
      const first = orbitBetween(rng, EARLIEST_ORBIT, LATEST_ORBIT - 2);
      const second = orbitBetween(rng, first + 2, LATEST_ORBIT);
      return [first, second].map((atOrbit) => ({ atOrbit, orbits: 1, mock: "relay", kind: "dark", params: { kind: "node", id: "C" } }));
    }
    case "identity-burst":
      return [{ atOrbit: orbitBetween(rng, EARLIEST_ORBIT, LATEST_ORBIT), orbits: 1, mock: "identity", kind: "error-burst", params: { rate: 0.5 } }];
  }
}

/**
 * system-spec §10: the storm draw is three to five of the candidates, each at a seed-chosen orbit, always with a
 * fault an ingest can see. Sorted by atOrbit so the stored schedule reads in injection order.
 */
export function hiddenStormDraw(teamSeed: string): FaultEvent[] {
  const rng = new Rng(subSeed(teamSeed, STORM_HIDDEN_COMPONENT));
  const count = orbitBetween(rng, MIN_PICKS, MAX_PICKS);
  const pool = [...STORM_CANDIDATES];
  const picked: StormCandidate[] = [];
  while (picked.length < count) picked.push(pool.splice(rng.int(pool.length), 1)[0]!);
  // Time to detect anchors on a relay fault an ingest can see; a draw with neither would measure the seam against
  // a symptom it never receives, so one of the two is always in it.
  if (!picked.includes("relay-duplicates") && !picked.includes("relay-bitflip")) picked[picked.length - 1] = rng.chance(0.5) ? "relay-duplicates" : "relay-bitflip";
  const events = STORM_CANDIDATES.filter((c) => picked.includes(c)).flatMap((c) => eventsFor(c, rng));
  return events.sort((a, b) => a.atOrbit - b.atOrbit);
}
