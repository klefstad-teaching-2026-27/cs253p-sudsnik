import type { Scenario, ScenarioName } from "@sudsnik/contracts";
import { scenario as darkSide } from "./dark-side.js";
import { scenario as hostileNotes } from "./hostile-notes.js";
import { scenario as laundryDay } from "./laundry-day.js";
import { scenario as migration } from "./migration.js";
import { scenario as quietOrbit } from "./quiet-orbit.js";
import { scenario as storm } from "./storm.js";

export const scenarios: Record<ScenarioName, Scenario> = {
  "quiet-orbit": quietOrbit,
  "dark-side": darkSide,
  "laundry-day": laundryDay,
  storm,
  "hostile-notes": hostileNotes,
  migration,
};
