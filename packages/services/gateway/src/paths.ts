import { fileURLToPath } from "node:url";

export const handlersDir = fileURLToPath(new URL("./handlers/", import.meta.url));
export const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));
