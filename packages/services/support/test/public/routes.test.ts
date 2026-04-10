import { afterEach, describe, expect, it } from "vitest";
import { TENANT_HEADER } from "@sudsnik/contracts";
import type { Report } from "@sudsnik/contracts/services/support";
import { boot, headers, postReport, postTriage, type Booted } from "../helpers.js";

const NOTE = "Strong ammonia smell from the pod on opening, crew reports it lingered in the module.";

/**
 * The report routes every variant serves. What the triage itself answers, and what it costs in oracle calls,
 * is the week's own work and belongs in `test/hidden/`.
 */
describe("routes", () => {
  let b: Booted;
  afterEach(() => b.close());

  it("creates, reads, re-triages, and escalates a report", async () => {
    b = await boot();
    const { status, report } = await postReport(b.app, { note: NOTE });
    expect(status).toBe(201);
    expect(report.state).toBe("triaged");
    expect(report.triage).toMatchObject({ category: expect.any(String), severity: expect.any(String), action: expect.any(String) });

    const got = await b.app.inject({ url: `/reports/${report.reportId}`, headers: headers(undefined) });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toEqual(report);

    const again = await postTriage(b.app, report.reportId);
    expect(again.status).toBe(200);
    expect(again.triage).toMatchObject(report.triage!);

    const esc = await b.app.inject({ method: "POST", url: `/reports/${report.reportId}/escalate`, headers: headers() });
    expect(esc.statusCode).toBe(200);
    expect((esc.json() as Report).state).toBe("escalated");
    const after = await postTriage(b.app, report.reportId);
    expect(after.status).toBe(200);
    expect(((await b.app.inject({ url: `/reports/${report.reportId}`, headers: headers(undefined) })).json() as Report).state).toBe("escalated");
  });

  it("answers 404 for an unknown report and for another tenant's report", async () => {
    b = await boot();
    const { report } = await postReport(b.app, { note: NOTE });
    for (const url of ["/reports/nope", `/reports/${report.reportId}`]) {
      const other = await b.app.inject({ url, headers: { [TENANT_HEADER]: url.endsWith("nope") ? "op1" : "op2" } });
      expect(other.statusCode).toBe(404);
      expect(other.json()).toMatchObject({ code: "NOT_FOUND", retryable: false });
    }
    expect((await b.app.inject({ method: "POST", url: "/reports/nope/triage", headers: headers() })).statusCode).toBe(404);
    expect((await b.app.inject({ method: "POST", url: "/reports/nope/escalate", headers: headers() })).statusCode).toBe(404);
  });

  it("rejects an empty or oversized note", async () => {
    b = await boot();
    expect((await postReport(b.app, { note: "" })).status).toBe(400);
    expect((await postReport(b.app, { note: "x".repeat(2001) })).status).toBe(400);
  });

});
