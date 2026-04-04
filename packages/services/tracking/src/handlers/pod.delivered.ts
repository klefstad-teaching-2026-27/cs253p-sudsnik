import type { PodDelivered } from "@sudsnik/contracts/events";
import { onMove } from "../store.js";

export default onMove<PodDelivered>("pod.delivered", ({ payload: p }) => ({ podId: p.podId, kind: "node", id: p.nodeId, since: p.deliveredAt }));
