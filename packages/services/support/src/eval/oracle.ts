import { CompleteResponse } from "@sudsnik/contracts/mocks/oracle";
import { TENANT_HEADER, type OracleClient } from "@sudsnik/contracts";
import { err, ok, sudsnikError } from "@sudsnik/kernel";

export interface Injectable {
  inject(opts: { method: "POST"; url: string; headers: Record<string, string>; payload: unknown }): Promise<{ statusCode: number; json(): unknown }>;
}

/** An OracleClient over an in-process oracle mock; the eval and the tests use it so nothing touches the network. */
export function oracleOverInject(mock: Injectable): OracleClient {
  return {
    async complete(prompt, maxTokens, ctx) {
      const res = await mock.inject({ method: "POST", url: "/complete", headers: { [TENANT_HEADER]: ctx.tenantId }, payload: { prompt, maxTokens } });
      if (res.statusCode !== 200) return err(sudsnikError("UNAVAILABLE", `oracle mock answered ${res.statusCode}`));
      const parsed = CompleteResponse.safeParse(res.json());
      return parsed.success ? ok(parsed.data) : err(sudsnikError("INVALID", `oracle mock body: ${parsed.error.message}`));
    },
  };
}
