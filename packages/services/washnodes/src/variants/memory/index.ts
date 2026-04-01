import type { ServiceDeps } from "@sudsnik/contracts";
import { bootService } from "@sudsnik/infra-boot";
import { sqliteCycleRepo } from "../../adapters/db/cycleRepo.js";
import { sqliteWasherRepo } from "../../adapters/db/washerRepo.js";
import { memoryHoldStore } from "../../adapters/holdStore/memory.js";
import { RECONCILE, composeApp, sharedHandlersDir, type AppOptions, type Profile, type WashnodesApp } from "../../app/compose.js";
import { readEnv } from "../../env.js";

export const variant = "memory";
export const handlersDir = sharedHandlersDir;
/** The starter's storage: the indexed inventory, but holds in a Map that a restart forgets. */
export const profile: Profile = {
  washers: (db) => sqliteWasherRepo(db),
  holds: (_db, washers) => memoryHoldStore(washers),
  cycles: sqliteCycleRepo,
  reconcile: RECONCILE,
};

export const createApp = (deps: ServiceDeps, opts?: AppOptions): Promise<WashnodesApp> => composeApp(deps, variant, profile, opts);
export const start = async (): Promise<void> => void (await bootService({ service: "washnodes", readEnv, createApp, handlersDir }));
export { readEnv };
