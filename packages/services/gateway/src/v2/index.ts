import type { VersionPrefix } from "../routing.js";

/**
 * The gateway's second API surface. Every variant that serves `/v2` reaches it through this file, so the name
 * below is the one the rest of the gateway imports: keep it.
 *
 * `VersionPrefix` is in `../routing.js`. It is asked, for one request, what to prepend to the upstream path,
 * and returns the empty string to leave the path alone. A service that has not migrated has one surface and
 * must keep answering on it, so `/v2/<that service>` still has to reach it.
 *
 * Until a service migrates there is nothing to prepend, which is what this returns.
 */
export const versionPrefix: VersionPrefix = () => "";
