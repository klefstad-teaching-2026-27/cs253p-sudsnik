import { readFileSync } from "node:fs";
import { FaultScheduleSchema, HABITATS, isHabitatVisible, type FaultEvent, type FaultSchedule, type MockName, type ScenarioName } from "@sudsnik/contracts";

export function loadFaultSchedule(path: string | URL): FaultSchedule {
  return FaultScheduleSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function knownFaultsUrl(scenario: ScenarioName): URL {
  return new URL(`../../faults/${scenario}.known.json`, import.meta.url);
}

/** system-spec §10: an event applies from atOrbit for `orbits` orbits, or to the end of the run when absent. */
export function isFaultActive(event: FaultEvent, orbit: number): boolean {
  return orbit >= event.atOrbit && (event.orbits === undefined || orbit < event.atOrbit + event.orbits);
}

export function activeFaults(events: readonly FaultEvent[], orbit: number, mock?: MockName): FaultEvent[] {
  return events.filter((e) => isFaultActive(e, orbit) && (mock === undefined || e.mock === mock));
}

/** Ids under an active `dark` fault at the orbit, in schedule order. */
export function faultDarkIds(events: readonly FaultEvent[], orbit: number): string[] {
  const ids: string[] = [];
  for (const e of activeFaults(events, orbit, "relay")) {
    if (e.kind !== "dark") continue;
    const id = e.params.id;
    if (typeof id === "string" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** system-spec §7 and §10.3: habitats outside their link window plus every id under a dark fault. */
export function darkIdsAt(events: readonly FaultEvent[], orbit: number, nowMs: number): string[] {
  const dark = HABITATS.filter((h) => !isHabitatVisible(h, nowMs));
  for (const id of faultDarkIds(events, orbit)) if (!dark.includes(id)) dark.push(id);
  return dark;
}
