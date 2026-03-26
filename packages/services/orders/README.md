# `@sudsnik/service-orders`

The order lifecycle of `docs/system-spec.md` §9.3: `place`, `cancel`, `get`, `list` over `orders.sqlite`, the transition table as data in `src/stateMachine.ts`, and saga coordination with `dispatch` (by event), `washnodes` (by event), and `billing` (HTTP behind `billing.enabled`, retried once per orbit by the reconciliation job, which also picks up orders placed or cancelled while the flag was off).

`POST /orders/:orderId/cancel` answers 200 with the order as it stands: nothing is recorded, nothing is compensated, and nothing is published. The cancel transition the state machine holds is reached from the give-up path instead — a final `wash.faulted`, or a `pickup.failed` from `dispatch` — which cancels the order in place and publishes `order.cancelled` naming the topic it gave up on, with `origin` `system` and the compensations `refund` and `release-hold`.

Layout: `src/core/` holds the implementation (`OrdersService`, `OrderRepository` over Drizzle with `src/schema.ts`, the routes, and `composeApp`); `src/handlers/` holds one thin class per consumed topic that hands the envelope to whichever service `createApp(deps)` bound; `src/variants/cancel-noop/` supplies the port's `cancel` over it, and `src/index.ts` selects it.

Tables (`migrations/`): `orders` (`order_id`, `tenant_id`, `state`, `payment`, timestamps, the optional `Order` fields), `saga_steps` (`order_id`, `step`, `at`, `detail`, `envelope_id` for the event that caused the step; steps are `place`, `authorize[:pending|:failed]`, `cancel`, `refund[:pending|:failed]`, and the topic of every applied event), `consumed` (envelope ids for handler dedupe), and the `outbox` from `infra/queue`.

```sh
npx vitest run --project orders
```
