import { NODES, NODE_FIRMWARE, WASHERS_PER_NODE, washerId } from "@sudsnik/contracts";
import type { Db } from "@sudsnik/infra-db";
import { nodes, washers } from "./schema.js";

/**
 * Brings the stored fleet up to canon: every node and every washer canon names that has no row yet gets one idle.
 * Idempotent, so it runs on every start; a washer already there keeps its state, and a canon change needs no migration.
 */
export function seedFleet(db: Db): void {
  db.transaction(() => {
    for (const nodeId of NODES) {
      db.orm.insert(nodes).values({ nodeId, inContact: true, lastContactAt: null }).onConflictDoNothing().run();
      for (let i = 0; i < WASHERS_PER_NODE; i++) {
        db.orm
          .insert(washers)
          .values({ washerId: washerId(nodeId, i), nodeId, idx: i, firmware: NODE_FIRMWARE[nodeId], state: "idle", maintenance: false, holdId: null, faultedAt: null })
          .onConflictDoNothing()
          .run();
      }
    }
  });
}
