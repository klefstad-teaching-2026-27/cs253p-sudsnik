import type { ReturnScheduled } from "@sudsnik/contracts/events";
import { onMove } from "../store.js";

export default onMove<ReturnScheduled>("return.scheduled", ({ payload: p, occurredAt }) => ({ podId: p.podId, kind: "node", id: p.nodeId, since: occurredAt }));
