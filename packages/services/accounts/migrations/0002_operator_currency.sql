-- `op3` prices in AUD. 0001 seeded it USD and has already been
-- applied on every data directory that ever ran, and a migration is recorded by filename and skipped forever once
-- applied, so editing the seed would move the value only on a database created after the edit. The value moves in
-- its own migration instead, which runs on an existing database and on a fresh one that has just run 0001 alike.
-- The other three operators keep the currency 0001 gave them.
update operators set currency = 'AUD' where operator_id = 'op3';
