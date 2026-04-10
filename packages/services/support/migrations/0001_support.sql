create table reports (
  report_id text primary key,
  tenant_id text not null,
  order_id text not null,
  pod_id text not null,
  note text not null,
  received_at integer not null,
  state text not null,
  triage_id text
);
create index reports_tenant on reports (tenant_id, received_at);

create table triage_results (
  triage_id text primary key,
  report_id text not null,
  tenant_id text not null,
  category text not null,
  severity text not null,
  action text not null,
  tokens integer not null,
  guarded integer not null,
  triaged_at integer not null
);
create index triage_results_report on triage_results (report_id, triaged_at);

create table orders_seen (
  order_id text primary key,
  tenant_id text not null,
  pod_id text not null,
  habitat_id text not null,
  returned_at integer not null,
  orbits_elapsed real not null
);

create table notification_failures (
  notification_id text primary key,
  tenant_id text not null,
  order_id text,
  channel text not null,
  reason text not null,
  recorded_at integer not null
);

create table eval_fixtures (
  name text primary key,
  fixture_set text not null,
  note text not null,
  category text not null,
  severity text not null,
  action text not null,
  injected integer not null
);

create table handled_events (
  envelope_id text primary key,
  topic text not null,
  handled_at integer not null
);

create table token_usage (
  orbit integer primary key,
  tokens integer not null
);
