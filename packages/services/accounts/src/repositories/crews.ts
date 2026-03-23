import { asc, eq } from "drizzle-orm";
import type { Crew } from "@sudsnik/contracts/services/accounts";
import type { Db } from "@sudsnik/infra-db";
import { crews, habitats, operators } from "../schema.js";

export interface CrewsRepository {
  byHabitat(habitatId: string): Crew[];
  /** Every crew member with the operator that owns the habitat, joined per call; the naive variant's tenant check. */
  byHabitatWithOperator(habitatId: string): Array<{ crew: Crew; operatorId: string }>;
}

export function crewsRepository(db: Db): CrewsRepository {
  return {
    byHabitat: (habitatId) => db.orm.select().from(crews).where(eq(crews.habitatId, habitatId)).orderBy(asc(crews.crewId)).all(),
    byHabitatWithOperator: (habitatId) =>
      db.orm
        .select({ crew: crews, operatorId: operators.operatorId })
        .from(crews)
        .innerJoin(habitats, eq(crews.habitatId, habitats.habitatId))
        .innerJoin(operators, eq(habitats.operatorId, operators.operatorId))
        .where(eq(crews.habitatId, habitatId))
        .orderBy(asc(crews.crewId))
        .all(),
  };
}
