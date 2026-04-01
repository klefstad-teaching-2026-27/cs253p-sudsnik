import { eq } from "drizzle-orm";
import type { Db } from "@sudsnik/infra-db";
import type { NodeRepo } from "../../ports/nodeRepo.js";
import { nodes } from "./schema.js";

export function sqliteNodeRepo(db: Db): NodeRepo {
  return {
    inContact: (nodeId) => db.orm.select({ inContact: nodes.inContact }).from(nodes).where(eq(nodes.nodeId, nodeId)).get()?.inContact ?? false,
    setContact: (nodeId, inContact, nowMs) =>
      void db.orm
        .update(nodes)
        .set(inContact ? { inContact, lastContactAt: nowMs } : { inContact })
        .where(eq(nodes.nodeId, nodeId))
        .run(),
  };
}
