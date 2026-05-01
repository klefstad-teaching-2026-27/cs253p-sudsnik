# Releasing a stuck washer hold by hand

A hold is stuck when `washers.state` is `held` and nothing will move it: the `memory` variant forgot its holds on a
restart, or a hold row is `held` past `expires_at` and the sweep is not running. Symptoms: `GET /nodes/:nodeId`
reports the washer `held` orbit after orbit, and `POST /holds` for that node answers 429 sooner than the fleet
size explains.

Stop the service or accept that it may write the same row while you do; the statements are idempotent either way.

## 1. Find the washer and its hold

```sh
sqlite3 "$SUDSNIK_DATA_DIR/washnodes.sqlite" \
  "select washer_id, node_id, firmware, state, hold_id from washers where state = 'held';"
sqlite3 "$SUDSNIK_DATA_DIR/washnodes.sqlite" \
  "select hold_id, tenant_id, order_id, state, expires_at, version, firmware_ref from holds where washer_id = 'B3';"
```

With the `memory` variant there is no `holds` row: the hold lived in the process. `firmware_ref` is then unknown
and step 2 is skipped; the firmware hold lapses on its own one orbit after it was placed.

## 2. Release the hold at the firmware

`X-Sudsnik-Tenant` is the hold's `tenant_id`. Firmware answers 200 or 204 whether or not it still had the hold.

Node `A` (firmware v1, `firmware_ref` is the hold token):

```sh
curl -sS -X POST "$SUDSNIK_WASHER_V1_URL/release" \
  -H "content-type: application/json" -H "X-Sudsnik-Tenant: op1" \
  -d '{"washer":"A3","holdToken":"<firmware_ref>"}'
```

Nodes `B` and `C` (firmware v2, `firmware_ref` is the firmware's hold id):

```sh
curl -sS -X DELETE "$SUDSNIK_WASHER_V2_URL/holds/<firmware_ref>" -H "X-Sudsnik-Tenant: op1"
```

## 3. Release the hold here

Mark the hold released with a bumped version, so an in-flight `releaseHold` or `startCycle` that read the old
version gets 409 rather than acting on it, then free the washer only if it still carries that hold:

```sh
sqlite3 "$SUDSNIK_DATA_DIR/washnodes.sqlite" <<'SQL'
begin immediate;
update holds set state = 'released', version = version + 1, reason = 'runbook: released by hand'
  where hold_id = '<hold_id>' and state = 'held';
update washers set state = 'idle', hold_id = null
  where washer_id = 'B3' and hold_id = '<hold_id>';
commit;
SQL
```

Without a `holds` row (the `memory` variant), free the washer alone:

```sh
sqlite3 "$SUDSNIK_DATA_DIR/washnodes.sqlite" \
  "update washers set state = 'idle', hold_id = null where washer_id = 'B3' and state = 'held';"
```

## 4. Tell the rest of the system

No `hold.released` event was published. If `dispatch` still counts the hold as active, release it through the
service instead of step 3 when the row exists, and it publishes the event: `POST /holds/<hold_id>/release` with
the tenant and an idempotency key. Only when that answers 404 or 409 fall back to the statements above.

Check: `GET /nodes/<node>` shows the washer `idle`, and a new `POST /holds` for the node succeeds.
