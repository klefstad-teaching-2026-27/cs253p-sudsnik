import { eq } from "drizzle-orm";
import type { Operator, OperatorPatch } from "@sudsnik/contracts/services/accounts";
import type { Db } from "@sudsnik/infra-db";
import { operators } from "../schema.js";

export interface OperatorsRepository {
  all(): Operator[];
  get(operatorId: string): Operator | undefined;
  update(operatorId: string, patch: OperatorPatch): void;
}

export function operatorsRepository(db: Db): OperatorsRepository {
  return {
    all: () => db.orm.select().from(operators).all(),
    get: (operatorId) => db.orm.select().from(operators).where(eq(operators.operatorId, operatorId)).get(),
    update(operatorId, patch) {
      db.orm.update(operators).set(patch).where(eq(operators.operatorId, operatorId)).run();
    },
  };
}
