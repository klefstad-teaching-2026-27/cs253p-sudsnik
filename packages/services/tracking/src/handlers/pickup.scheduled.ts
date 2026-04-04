import type { PickupScheduled } from "@sudsnik/contracts/events";
import { onMove } from "../store.js";

export default onMove<PickupScheduled>("pickup.scheduled", ({ payload: p, occurredAt }) => ({ podId: p.podId, kind: "habitat", id: p.habitatId, since: occurredAt }));
