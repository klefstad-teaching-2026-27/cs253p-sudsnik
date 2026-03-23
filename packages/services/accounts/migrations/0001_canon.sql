create table operators (
  operator_id text primary key,
  name text not null,
  pricing_tier text not null check (pricing_tier in ('standard', 'priority')),
  region text not null check (region in ('us', 'eu', 'apac')),
  currency text not null check (length(currency) = 3)
);

create table habitats (
  habitat_id text primary key,
  operator_id text not null references operators (operator_id),
  idx integer not null unique check (idx >= 0),
  name text not null
);

create table crews (
  crew_id text primary key,
  habitat_id text not null references habitats (habitat_id),
  name text not null,
  preferences text not null
);
create index crews_habitat on crews (habitat_id);

insert into operators (operator_id, name, pricing_tier, region, currency) values
  ('op1', 'Aurora Orbital Services', 'standard', 'us', 'USD'),
  ('op2', 'Helios Habitat Group', 'priority', 'eu', 'EUR'),
  ('op3', 'Meridian Stations', 'standard', 'apac', 'USD'),
  ('op4', 'Polaris Habitats', 'priority', 'us', 'USD');

insert into habitats (habitat_id, operator_id, idx, name) values
  ('hab01', 'op1', 0, 'Aurora Ring'),
  ('hab02', 'op1', 1, 'Aurora Spur'),
  ('hab03', 'op1', 2, 'Aurora Keel'),
  ('hab04', 'op2', 3, 'Helios Prime'),
  ('hab05', 'op2', 4, 'Helios Dawn'),
  ('hab06', 'op2', 5, 'Helios Vale'),
  ('hab07', 'op3', 6, 'Meridian Crest'),
  ('hab08', 'op3', 7, 'Meridian Reach'),
  ('hab09', 'op3', 8, 'Meridian Tide'),
  ('hab10', 'op4', 9, 'Polaris Hub'),
  ('hab11', 'op4', 10, 'Polaris Arc'),
  ('hab12', 'op4', 11, 'Polaris Drift');

insert into crews (crew_id, habitat_id, name, preferences) values
  ('hab01-c1', 'hab01', 'Ada', '{"detergent":"unscented","fold":"rolled"}'),
  ('hab01-c2', 'hab01', 'Bram', '{"detergent":"citrus","fold":"flat"}'),
  ('hab01-c3', 'hab01', 'Cleo', '{"detergent":"lavender","fold":"hung"}'),
  ('hab02-c1', 'hab02', 'Dev', '{"detergent":"citrus","fold":"hung"}'),
  ('hab02-c2', 'hab02', 'Elin', '{"detergent":"lavender","fold":"rolled"}'),
  ('hab02-c3', 'hab02', 'Fenn', '{"detergent":"unscented","fold":"flat"}'),
  ('hab03-c1', 'hab03', 'Gia', '{"detergent":"lavender","fold":"flat"}'),
  ('hab03-c2', 'hab03', 'Hal', '{"detergent":"unscented","fold":"hung"}'),
  ('hab03-c3', 'hab03', 'Ines', '{"detergent":"citrus","fold":"rolled"}'),
  ('hab04-c1', 'hab04', 'Jun', '{"detergent":"unscented","fold":"rolled"}'),
  ('hab04-c2', 'hab04', 'Kai', '{"detergent":"citrus","fold":"flat"}'),
  ('hab04-c3', 'hab04', 'Lior', '{"detergent":"lavender","fold":"hung"}'),
  ('hab05-c1', 'hab05', 'Mira', '{"detergent":"citrus","fold":"hung"}'),
  ('hab05-c2', 'hab05', 'Nils', '{"detergent":"lavender","fold":"rolled"}'),
  ('hab05-c3', 'hab05', 'Orla', '{"detergent":"unscented","fold":"flat"}'),
  ('hab06-c1', 'hab06', 'Pim', '{"detergent":"lavender","fold":"flat"}'),
  ('hab06-c2', 'hab06', 'Quin', '{"detergent":"unscented","fold":"hung"}'),
  ('hab06-c3', 'hab06', 'Rae', '{"detergent":"citrus","fold":"rolled"}'),
  ('hab07-c1', 'hab07', 'Sol', '{"detergent":"unscented","fold":"rolled"}'),
  ('hab07-c2', 'hab07', 'Tove', '{"detergent":"citrus","fold":"flat"}'),
  ('hab07-c3', 'hab07', 'Uma', '{"detergent":"lavender","fold":"hung"}'),
  ('hab08-c1', 'hab08', 'Vik', '{"detergent":"citrus","fold":"hung"}'),
  ('hab08-c2', 'hab08', 'Wren', '{"detergent":"lavender","fold":"rolled"}'),
  ('hab08-c3', 'hab08', 'Xan', '{"detergent":"unscented","fold":"flat"}'),
  ('hab09-c1', 'hab09', 'Yara', '{"detergent":"lavender","fold":"flat"}'),
  ('hab09-c2', 'hab09', 'Zed', '{"detergent":"unscented","fold":"hung"}'),
  ('hab09-c3', 'hab09', 'Ash', '{"detergent":"citrus","fold":"rolled"}'),
  ('hab10-c1', 'hab10', 'Bo', '{"detergent":"unscented","fold":"rolled"}'),
  ('hab10-c2', 'hab10', 'Cy', '{"detergent":"citrus","fold":"flat"}'),
  ('hab10-c3', 'hab10', 'Dot', '{"detergent":"lavender","fold":"hung"}'),
  ('hab11-c1', 'hab11', 'Eve', '{"detergent":"citrus","fold":"hung"}'),
  ('hab11-c2', 'hab11', 'Finn', '{"detergent":"lavender","fold":"rolled"}'),
  ('hab11-c3', 'hab11', 'Gus', '{"detergent":"unscented","fold":"flat"}'),
  ('hab12-c1', 'hab12', 'Hex', '{"detergent":"lavender","fold":"flat"}'),
  ('hab12-c2', 'hab12', 'Ivo', '{"detergent":"unscented","fold":"hung"}'),
  ('hab12-c3', 'hab12', 'Jo', '{"detergent":"citrus","fold":"rolled"}');
