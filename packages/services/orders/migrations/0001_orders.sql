create table if not exists orders (
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
create index if not exists orders_tenant_pod_state on orders (tenant_id, pod_id, state);
create index if not exists orders_tenant_state on orders (tenant_id, state, order_id);
create index if not exists orders_payment on orders (payment, state);

create table if not exists saga_steps (
  seq integer primary key autoincrement,
  order_id text not null,
  step text not null,
  at integer not null,
  detail text
);
create index if not exists saga_steps_order on saga_steps (order_id, seq);

create table if not exists consumed (
  envelope_id text primary key,
  topic text not null,
  at integer not null
);
