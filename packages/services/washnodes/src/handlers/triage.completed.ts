import { TriageCompleted } from "@sudsnik/contracts/events";
import { ok } from "@sudsnik/kernel";
import { handler } from "../app/handler.js";

export default handler("triage.completed", TriageCompleted, async (rt, e) => {
  rt.reports.triaged(e.tenantId, e.payload);
  return ok(undefined);
});
