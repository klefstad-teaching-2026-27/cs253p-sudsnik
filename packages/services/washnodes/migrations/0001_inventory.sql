-- Schema only. The fleet and the node list come from canon at startup (src/adapters/db/fleet.ts),
-- so a canon change needs no migration.
create table washers (
  washer_id text primary key,
  node_id text not null,
  idx integer not null,
  firmware text not null,
  state text not null default 'idle',
  maintenance integer not null default 0,
  hold_id text,
  faulted_at integer
);
create index washers_node_state on washers (node_id, state, maintenance, idx);

create table nodes (
  node_id text primary key,
  in_contact integer not null default 1,
  last_contact_at integer
);

create table holds (
  hold_id text primary key,
  tenant_id text not null,
  node_id text not null,
  washer_id text not null,
  order_id text not null,
  state text not null,
  acquired_at integer not null,
  expires_at integer not null,
  version integer not null default 0,
  firmware_ref text not null,
  ended_at integer,
  reason text
);
create index holds_state_expires on holds (state, expires_at);
create index holds_order on holds (order_id);

create table cycles (
  cycle_id text primary key,
  tenant_id text not null,
  correlation_id text not null,
  hold_id text not null,
  order_id text not null,
  pod_id text,
  node_id text not null,
  washer_id text not null,
  firmware text not null,
  attempt integer not null,
  state text not null,
  started_at integer not null,
  ended_at integer,
  cycle_units integer,
  fault_code text,
  retry_pending integer not null default 0
);
create index cycles_running on cycles (state, firmware, started_at);
create index cycles_order on cycles (order_id, attempt);
create index cycles_hold on cycles (hold_id);

create table washer_reports (
  report_id text primary key,
  tenant_id text not null,
  order_id text,
  pod_id text,
  washer_id text,
  action text
);

create table handled_events (
  event_id text primary key,
  handled_at integer not null
);

create table washer_callbacks (
  callback_id text primary key,
  received_at integer not null
);
