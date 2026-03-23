import { eq } from "drizzle-orm";
import type { Habitat } from "@sudsnik/contracts/services/accounts";
import type { Db } from "@sudsnik/infra-db";
import { habitats } from "../schema.js";

export interface HabitatsRepository {
  get(habitatId: string): Habitat | undefined;
}

export function habitatsRepository(db: Db): HabitatsRepository {
  return {
    get: (habitatId) => db.orm.select().from(habitats).where(eq(habitats.habitatId, habitatId)).get(),
  };
}
