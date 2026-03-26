import { fileURLToPath } from "node:url";

/** Shared by every variant: the handlers are thin and the selected service decides what an event does. */
export const handlersDir = fileURLToPath(new URL("../handlers/", import.meta.url));
export const migrationsDir = fileURLToPath(new URL("../../migrations/", import.meta.url));
