# #eng-sudsnik — 2026-05-01, why is nothing the same shape

**14:03 Barbara Liskov**
i've now read four services and they're four different codebases

**14:03 Barbara Liskov**
orders has core/ and handlers/, dispatch has everything flat, washnodes has ports/ and adapters/, notify has a
pipeline thing

**14:05 Grace Hopper**
yes

**14:05 Barbara Liskov**
is that on purpose

**14:07 Grace Hopper**
it's what happens when four people build four services in parallel against the same contracts. the boundary is
fixed — the routes, the env, the topics, the drain. inside is whoever wrote it

**14:08 Barbara Liskov**
i'm not saying it's wrong, i'm saying it cost me a morning

**14:09 Margaret Hamilton**
it costs everyone a morning, once per service. the alternative cost us six weeks of arguing about folder names
before anything shipped

**14:11 Barbara Liskov**
ok. then the boundary needs to be written down properly, because that's the part i can rely on

**14:12 Margaret Hamilton**
it is. `docs/system-spec.md` §5.1. exports, the four infra routes, migrations before ready, all time from the
clock, all calls through the injected clients, drain on sigterm

**14:12 Grace Hopper**
and the lint rules, which are the part a new person breaks first

**14:14 Barbara Liskov**
right. i'll stop complaining. but when someone new joins, point them at the boundary and tell them the insides
differ on purpose, rather than letting them find out the way i did
