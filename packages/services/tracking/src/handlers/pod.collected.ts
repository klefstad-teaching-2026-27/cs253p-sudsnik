import type { PodCollected } from "@sudsnik/contracts/events";
import { onMove } from "../store.js";

export default onMove<PodCollected>("pod.collected", ({ payload: p }) => ({ podId: p.podId, kind: "shuttle", id: p.shuttleId, since: p.collectedAt }));
