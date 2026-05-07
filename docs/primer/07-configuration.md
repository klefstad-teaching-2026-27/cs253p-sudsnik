# Environment variables and configuration

Page 7 of the primer. You have the stack running ([`01-processes-and-services.md` §2](01-processes-and-services.md)).

## 1. What configuration is here

A service needs values it cannot compile in: which port to listen on, where the other services are, where to put
its database file. Those come from the process environment, which is a set of name-to-string pairs the operating
system hands a process when it starts. Nothing else varies between a laptop and the grader.

Sudsnik reads the environment in exactly one place per service. `packages/services/orders/src/env.ts` is the
whole of it:

```ts
import { OrdersEnvSchema, type OrdersEnv } from "@sudsnik/contracts/services/orders";
import { readEnvWith } from "@sudsnik/infra-boot";
import type { Result } from "@sudsnik/kernel";

export function readEnv(): Result<OrdersEnv> {
  return readEnvWith(OrdersEnvSchema);
}
```

`OrdersEnvSchema` is in `packages/contracts/src/services/orders/env.ts`, and it is `CommonEnvSchema` from
`packages/contracts/src/env.ts` unchanged. That schema is a zod object of twenty-five names, each with the shape
it must have and three of them with a default. `SUDSNIK_SEED` must be sixteen hexadecimal characters.
`SUDSNIK_PORT` must coerce to an integer in `1..65535`. The names and what each means are
`docs/system-spec.md` §5.3; a service that wants one of its own adds it to its own schema, which is what
`SUDSNIK_TRACKING_CACHE_TTL_MS` is.

Reading `process.env` anywhere else is a lint error, `env-via-read-env` (`docs/system-spec.md` §5.4). The point is
that one file per service lists everything that service can be configured with, and it is checkable.

## 2. Where the values you are running with came from

You did not set any of these. `npm start` filled them in: `withDefaults` in `apps/cli/src/env.ts` sets every
`SUDSNIK_` name that is not already set, and leaves alone every one that is. That is why the banner can print
every URL it bound. Under the grader nothing is unset and none of those defaults apply.

## 3. What a missing variable does

Start one service by hand with no environment at all. This is what a service's `start()` does, without the
defaults `npm start` supplies:

```sh
env -i PATH="$PATH" node --import tsx apps/cli/src/service-entry.ts orders
```

It prints a file and line, then one long line that starts like this and goes on to name every variable, then a
stack trace:

```
Error: environment invalid: SUDSNIK_PORT: Invalid input: expected number, received NaN; SUDSNIK_SEED: Invalid input: expected string, received undefined; SUDSNIK_DATA_DIR: Invalid input: expected string, received undefined; SUDSNI
```

That is the first 230 characters of it, cut mid-word. There are twenty-two names in the full line. The exit code
is 1.

Read what did not happen. No port was opened. `/ready` was never served, because nothing is listening to serve
it. There is no `orders` in a bad state to go and ask. `bootService` in `packages/infra/boot/src/index.ts` calls
`readEnv()` and throws on a failure before it calls `listen`, so a service with a configuration mistake is not a
sick service. It is an absent one, and the only place its complaint appears is the log of whatever started it.

That distinction is worth holding on to, because the two failures look nothing alike from the outside. A service
that is up but not ready answers `/ready` with 503 and `{"ready":false,"service":"orders"}`, which at least
tells you it is there. A service that never started refuses the connection, and the only way to learn anything
is to find the output of whatever tried to start it.

## 4. Exercise

Run the command in §3 twice, once as written and once with `SUDSNIK_PORT=4001` added in front of `node`, and
count the names in each complaint:

```sh
env -i PATH="$PATH" node --import tsx apps/cli/src/service-entry.ts orders 2>&1 \
  | grep -o 'SUDSNIK_[A-Z0-9_]*' | sort -u | wc -l
```

You should get 22 for the first and 21 for the second. Then answer from `CommonEnvSchema` rather than from the
message: it declares twenty-five names and the complaint only ever reaches twenty-two of them. Name the three
that are missing from it, and say what the schema does with each that keeps it out.
