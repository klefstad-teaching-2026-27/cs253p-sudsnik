import type { WashStarted } from "@sudsnik/contracts/events";
import { onMove } from "../store.js";

// A wash starts where `pod.delivered` put the pod; the event names a washer, not a location.
export default onMove<WashStarted>("wash.started", () => undefined);
