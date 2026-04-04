create table positions (
  shuttle_id text primary key,
  orbit_phase real not null,
  observed_at integer not null
);
create table pod_locations (
  pod_id text primary key,
  tenant_id text not null,
  order_id text not null,
  kind text not null,
  id text not null,
  since integer not null
);
create table callbacks (id text primary key);
create table handled (id text primary key);
create table rejected_callbacks (id text primary key, body text not null, rejected_at integer not null);
