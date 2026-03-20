create table if not exists operators (
  tenant_id text not null,
  operator_id text not null,
  region text not null,
  pricing_tier text not null,
  updated_at integer not null,
  primary key (tenant_id, operator_id)
);
create table if not exists handled_events (
  envelope_id text primary key,
  topic text not null,
  handled_at integer not null
);
