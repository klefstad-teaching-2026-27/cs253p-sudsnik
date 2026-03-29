create table orders (
  order_id text primary key,
  tenant_id text not null,
  habitat_id text not null,
  pod_id text not null,
  requested_at integer not null,
  correlation_id text not null,
  state text not null,
  progress integer not null default 0,
  attempts integer not null default 0,
  hold_attempts integer not null default 0,
  hold_failures integer not null default 0,
  retry_at integer not null default 0,
  delivered_at integer,
  wait_node text,
  updated_at integer not null
);
create index orders_queue on orders (state, retry_at);
create index orders_waiting on orders (state, wait_node);

create table assignments (
  id text primary key,
  order_id text not null,
  tenant_id text not null,
  leg text not null,
  shuttle_id text not null,
  node_id text not null,
  hold_id text,
  window_start integer not null,
  window_end integer not null,
  state text not null,
  created_at integer not null,
  updated_at integer not null
);
create index assignments_order on assignments (order_id, leg, created_at);

create table holds (
  hold_id text primary key,
  tenant_id text not null,
  order_id text not null,
  node_id text not null,
  washer_id text not null,
  state text not null,
  acquired_at integer not null,
  expires_at integer not null,
  updated_at integer not null
);
create index holds_order on holds (order_id, acquired_at);
create index holds_node on holds (node_id, state);

create table trips (
  shuttle_id text not null,
  window_start integer not null,
  habitat_id text not null,
  node_id text not null,
  pods integer not null default 0,
  primary key (shuttle_id, window_start)
);

create table rotation (
  name text primary key,
  next_index integer not null default 0
);

create table shuttle_positions (
  shuttle_id text primary key,
  orbit_phase real not null,
  observed_at integer not null
);

create table consumed_events (
  envelope_id text primary key,
  topic text not null,
  consumed_at integer not null
);

create table relay_callbacks (
  id text primary key,
  tenant_id text not null,
  kind text not null,
  order_id text,
  received_at integer not null
);

create table rejected_callbacks (
  seq integer primary key autoincrement,
  callback_id text,
  tenant_id text not null,
  reason text not null,
  body text not null,
  received_at integer not null
);
