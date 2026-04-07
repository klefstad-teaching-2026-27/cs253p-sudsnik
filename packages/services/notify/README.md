# notify

Renders a notification per consumed event and delivers it to the habitat through `relay`. Port: `NotifyService` (`contracts/src/services/notify/`): `POST /notifications` sends one on request, `GET /habitats/:habitatId/digest` lists what is still waiting for a habitat and when its next link window opens.

## Shape

Event-driven: `src/handlers/` (one per consumed topic, dispatching to the runtime `src/runtime.ts` bound), `src/templates/` (topic to `{ title, body }` and the channel it goes out on), `src/queue/` (ingest stages and the SQL store), `src/delivery/` (window and relay stages). Stages are `stage(name, fn)` composed with `pipeline` (`src/pipeline.ts`); `src/variants/exactly-once/` composes the ingest and delivery pipelines the service runs, and `src/index.ts` selects it.

Ingest is `parse`, `resolve` (the habitat the event names, else the one the orders table knows, else the one a pod id embeds), `render`, `persist`, and a dispatch stage that hands the new notification straight to delivery. Delivery is `send` and `mark-delivered`: `relay` is called once, and the notification is marked delivered and the attempt recorded whatever `relay` answered. A sweep runs every simulated minute and has nothing to do.

## Tables (`notify.sqlite`, `migrations/`)

| Table | Holds |
|---|---|
| `notifications` | One row per notification: habitat, template, rendered text, state, attempts, retry hold |
| `deliveries` | One row per relay attempt and its outcome |
| `orders` | `orderId` to `habitatId`, filled by the events that name both |
| `dedupe` | Envelope ids per tenant; ingest takes every envelope as new and writes no row |
| `dead_letters` | Notifications that spent an attempt budget; nothing spends one |
| `outbox` | `infra/queue`'s table, pumped to the bus |
