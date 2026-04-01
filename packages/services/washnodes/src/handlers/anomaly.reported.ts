import { AnomalyReported } from "@sudsnik/contracts/events";
import { ok } from "@sudsnik/kernel";
import { handler } from "../app/handler.js";

export default handler("anomaly.reported", AnomalyReported, async (rt, e) => {
  rt.reports.reported(e.tenantId, e.payload);
  return ok(undefined);
});
