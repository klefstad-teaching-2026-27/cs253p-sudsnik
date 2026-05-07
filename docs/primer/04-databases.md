# Databases, tables, queries, and transactions

Page 4 of the primer. You have placed at least one order ([`02-http.md` §3](02-http.md)).

This page uses the `sqlite3` command-line tool. It ships with macOS and is a package away on Linux
(`apt install sqlite3`). Everything here can also be done from a Node prompt with `better-sqlite3`, which the
repository already depends on, but the shell tool is shorter.

## 1. One file per service

A database is where a service keeps what must outlive its process. Sudsnik gives each service its own SQLite
file under `SUDSNIK_DATA_DIR`, which on a laptop is `data/` (`docs/system-spec.md` §5.1, rule 9):

```sh
ls data/*.sqlite
```

```
data/accounts.sqlite
data/bus.sqlite
data/dispatch.sqlite
data/gateway.sqlite
data/notify.sqlite
data/orders.sqlite
data/support.sqlite
data/tracking.sqlite
data/washnodes.sqlite
```

Plain `ls data` shows more: a `-wal` and a `-shm` beside each of those, which are SQLite's write-ahead log and
its shared-memory index and come and go on their own, and the `logs`, `otel`, and `mocks` directories. `billing`
has no file because `billing` is not running ([`01-processes-and-services.md` §4](01-processes-and-services.md)); `bus.sqlite` belongs to no one
service, which is [`06-queues-and-events.md`](06-queues-and-events.md).

One file each is a design decision, not a SQLite limitation. No service can read another's rows, so the only way
to ask `orders` something is to ask `orders`. That is the whole reason the rest of this course is about
messages.

## 2. Tables and columns

A table is rows of a fixed shape. Ask `orders` what it has:

```sh
sqlite3 data/orders.sqlite '.tables'
```

```
_migrations  consumed     orders       outbox       saga_steps 
```

Five, and only one of them is what you would have guessed. `.schema` prints the statement that made a table:

```sh
sqlite3 data/orders.sqlite '.schema orders'
```

```
CREATE TABLE orders (
  order_id text primary key,
  tenant_id text not null,
  habitat_id text not null,
  pod_id text not null,
  state text not null,
  payment text not null,
  placed_at integer not null,
  updated_at integer not null,
  shuttle_id text,
  node_id text,
  hold_id text,
  returned_at integer,
  orbits_elapsed real,
  cancel_reason text,
  notes text
);
CREATE INDEX orders_tenant_pod_state on orders (tenant_id, pod_id, state);
CREATE INDEX orders_tenant_state on orders (tenant_id, state, order_id);
CREATE INDEX orders_payment on orders (payment, state);
```

Nobody typed that at the database. It is `packages/services/orders/migrations/0001_orders.sql`, applied by
`createApp(deps)` before the service reports ready. A migration is a file of statements, checked into the
repository, applied in order and once each; `_migrations` is the table that remembers which have run. That is
why deleting `data/` and starting again gives you the same schema and no rows.

`not null` and `primary key` are the database's own share of the checking. The zod schemas of
[`03-apis-and-endpoints.md`](03-apis-and-endpoints.md) refuse bad input at the edge; these refuse bad rows at the bottom. Neither makes the
other unnecessary.

## 3. Queries

A query asks for rows. It is not a method call on an object; you say what you want and the database works out
how to get it.

```sh
sqlite3 -header -column data/orders.sqlite \
  "select order_id, state, payment, habitat_id, pod_id from orders;"
```

```
order_id                    state      payment  habitat_id  pod_id    
--------------------------  ---------  -------  ----------  ----------
01M336AQ2H2QKEF447WZC4V6VV  scheduled  pending  hab01       hab01-p001
```

One row per order you have placed, so mine has one and yours has as many as you made. The ids differ, and the
`state` may be anything from `placed` onwards, because the order has been moving while you read. Aggregate
instead of listing:

```sh
sqlite3 -header -column data/orders.sqlite "select state, count(*) as n from orders group by state;"
```

The `where` clause is what the indexes above exist for. `orders_tenant_pod_state` is there because the 409 you
got in [`02-http.md` §6](02-http.md) is a query for "an open order for this pod, for this tenant", run on the way into every
placement.

## 4. Transactions

A transaction is a group of statements that either all happen or none do. It is the answer to the question "what
if the process dies halfway".

Placing an order writes to two tables. Look at the other one:

```sh
sqlite3 -header -column data/orders.sqlite "select seq, step, at from saga_steps order by seq;"
```

```
seq  step              at    
---  ----------------  ------
1    place             120000
2    pickup.scheduled  180000
```

`saga_steps` is the audit trail of everything that happened to an order. The row in `orders` and the first row in
`saga_steps` are written inside one transaction, so there is no instant at which an order exists with no record
of being placed, and no instant at which the record exists without the order. `at` is simulated milliseconds
(`docs/system-spec.md` §2.2), so the two steps above are an orbit apart in Sudsnik time and were a few seconds
apart on your laptop.

There is a third table in that transaction, `outbox`, and it is the subject of [`06-queues-and-events.md`](06-queues-and-events.md).

## 5. Exercise

Place two more orders for two different pods in `hab03`. Then answer three questions with one query each, and
check each answer against the API.

1. How many orders exist for `hab03`? Compare with what
   `GET /v1/orders?habitatId=hab03` returns through `gateway`.
2. What is the earliest `placed_at` in the table, and which `order_id` has it?
3. How many `saga_steps` rows does your newest order have? Run the same query again two minutes later and
   explain the difference without looking at any other table.

Then one to reason about rather than run. `orders` writes the order row and its first `saga_steps` row in one
transaction. Suppose it did not, and wrote the order first and the step second, and the process died between
them. Describe the state the system would be in, and say which of the two orderings leaves a mess you could
clean up and which leaves one you could not.
