import type { Handler } from "@sudsnik/contracts";
import { ok } from "@sudsnik/kernel";
export const seen: string[] = [];
const handler: Handler = {
  topic: "order.placed",
  async handle(envelope) {
    seen.push(envelope.id);
    return ok(undefined);
  },
};
export default handler;
