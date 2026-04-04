import type { PodReturned } from "@sudsnik/contracts/events";
import { habitatOf, onMove } from "../store.js";

export default onMove<PodReturned>("pod.returned", ({ payload: p }) => ({ podId: p.podId, kind: "habitat", id: habitatOf(p.podId), since: p.returnedAt }));
