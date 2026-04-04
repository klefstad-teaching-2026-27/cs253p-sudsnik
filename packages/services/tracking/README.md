# tracking

Shuttle positions and pod locations. The position reads answer from `ephemeris`: `GET /positions/:shuttleId` asks it for the one shuttle, `GET /positions/cached/:shuttleId` asks it for that shuttle too, and `GET /positions` asks it once per shuttle in canon and answers with all six, each `source: "fresh"`. `GET /pods/:podId` is the pod's last known place (`habitat`, `shuttle`, or `node`) built from the dispatch events `src/handlers/` consumes, visible only to the pod's tenant.

`POST /callbacks/relay` takes `RelayCallback` of kind `position`: the checksum is verified, the body id deduped, the newest observation per shuttle kept, and `position.updated` published through the outbox.

Tables in `tracking.sqlite`: `positions` (last known per shuttle, written by the relay callback), `pod_locations` (per pod, with the order that moved it), `callbacks` and `handled` (dedupe by callback id and envelope id), `rejected_callbacks` (a callback whose checksum did not verify).

`src/app.ts` holds what the service is made of — the app, the relay ingest, the pod lookup — and `src/variants/` supplies the reads over it; `src/index.ts` selects it.
