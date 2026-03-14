import { TENANT_HEADER } from "@sudsnik/contracts";
import type { DeliverRequest } from "@sudsnik/contracts/mocks/relay";

export interface RelaySender {
  /** POSTs one delivery to relay `/deliver` on the tenant's behalf; a delivery relay does not accept is lost, as a real callback would be. */
  send(tenant: string, delivery: DeliverRequest): Promise<void>;
}

export function relaySender(relayUrl: string): RelaySender {
  return {
    async send(tenant, delivery) {
      try {
        await fetch(`${relayUrl}/deliver`, {
          method: "POST",
          headers: { "content-type": "application/json", [TENANT_HEADER]: tenant },
          body: JSON.stringify(delivery),
        });
      } catch {
        return;
      }
    },
  };
}
