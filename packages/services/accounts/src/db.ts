import { fileURLToPath } from "node:url";
import type { ServiceDeps } from "@sudsnik/contracts";
import { serviceDataFile } from "@sudsnik/infra-boot";
import { openDb, type Db } from "@sudsnik/infra-db";

const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

export function openAccountsDb(deps: ServiceDeps): Db {
  return openDb({ path: serviceDataFile(deps), service: deps.service, meter: deps.meter, migrationsDir });
}
