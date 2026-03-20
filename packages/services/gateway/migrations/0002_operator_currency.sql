-- SQLite requires a default to add a not-null column; rows written since carry the operator's own currency.
alter table operators add column currency text not null default 'USD';
