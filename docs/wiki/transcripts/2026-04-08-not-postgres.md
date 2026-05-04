# #eng-sudsnik — 2026-04-08, the database conversation again

**11:02 Radia Perlman**
genuine question: why are we running nine SQLite files instead of one postgres

**11:04 Leslie Lamport**
because with one postgres, within a month, three services would be reading each other's tables and we'd have one
system pretending to be nine

**11:04 Radia Perlman**
we could just... not do that

**11:05 Leslie Lamport**
we did do that. the pricing tier was being read straight out of the accounts table by two services that were
supposed to learn it from an event. that's what made me write ADR-0001.

**11:07 Radia Perlman**
fair. but now a question that spans two services costs two round trips

**11:08 Leslie Lamport**
yes. and the cost is visible, which is the point. when someone wants a cross-service join they have to actually
decide to pay for it instead of it being free at the query layer and expensive in the coupling.

**11:09 Margaret Hamilton**
also the deploy story. one file per service means a service can be down without taking the database with it.

**11:11 Radia Perlman**
what about the queue though, sqlite-as-a-queue is a bit much

**11:12 Leslie Lamport**
it is. it's on the list. the difference is that swapping the queue is a change behind `infra/queue` and swapping
the database is a change in every service.

**11:13 Radia Perlman**
ok. I'll stop asking.

**11:13 Leslie Lamport**
ask again in a year, the answer might be different
