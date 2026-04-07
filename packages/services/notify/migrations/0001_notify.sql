create table if not exists orders (
  tenant_id text not null,
  order_id text not null,
  habitat_id text not null,
  primary key (tenant_id, order_id)
);

create table if not exists dedupe (
  tenant_id text not null,
  envelope_id text not null,
  notification_id text,
  seen_at integer not null,
  primary key (tenant_id, envelope_id)
);

create table if not exists notifications (
  notification_id text primary key,
  tenant_id text not null,
  habitat_id text not null,
  order_id text,
  channel text not null,
  template text not null,
  params text not null,
  title text not null,
  body text not null,
  correlation_id text not null,
  state text not null,
  created_at integer not null,
  delivered_at integer,
  attempts integer not null default 0,
  not_before integer not null default 0
);
create index if not exists notifications_queued on notifications (state, not_before, habitat_id);
create index if not exists notifications_habitat on notifications (tenant_id, habitat_id, state);

create table if not exists deliveries (
  delivery_id text primary key,
  notification_id text not null,
  tenant_id text not null,
  attempt integer not null,
  attempted_at integer not null,
  outcome text not null,
  relay_delivery_id text,
  error text
);
create index if not exists deliveries_notification on deliveries (notification_id, attempt);

create table if not exists dead_letters (
  notification_id text primary key,
  tenant_id text not null,
  attempts integer not null,
  reason text not null,
  dead_at integer not null
);
