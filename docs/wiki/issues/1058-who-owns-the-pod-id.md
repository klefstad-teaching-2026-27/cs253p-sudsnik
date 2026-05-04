# #1058 — a habitat saw another operator's order

**State** closed (fixed) · **Labels** security, gateway · **Opened** Leslie Lamport, 2026-05-04

`GET /v1/orders` for `op2` returned an order belonging to `op1`. One row, one time, and it should be never.

## Comments

**Leslie Lamport** — The list query filtered by habitat and the habitat was passed from the query string without being
checked against the operator that owns it.

**Margaret Hamilton** — Every read is scoped by the tenant on the context, which comes from the token, not from the
request body and not from a query parameter.

**Leslie Lamport** — Fixed. Also added the rule to the lint: a schema for a persisted row without `tenantId` fails.

**Margaret Hamilton** — The release train checks it too, from the other side: it reads every event off the bus after
a run and fails the submission if a payload names an operator other than the envelope's tenant. Nothing gets to
be careful about this only in review.
