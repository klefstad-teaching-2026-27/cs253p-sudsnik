# Queues and events

Page 6 of the primer. You have placed an order ([`02-http.md` §3](02-http.md)).

## 1. Calling versus telling

There are two ways for one service to make something happen in another. It can call it, which means an HTTP
request and waiting for the answer. Or it can announce that something happened and go on with its day, and
whoever cares acts later.

The second is a message on a queue. Sudsnik's queue is a table in `data/bus.sqlite` that every service reads and
writes (`docs/system-spec.md` §5.5, `Bus`). A message is an envelope: an id, a topic, a tenant, a timestamp, a
correlation id, and a payload. The topics that exist, and which service is allowed to publish and consume each,
are `docs/system-spec.md` §9.1, generated from `packages/contracts/src/topics.ts`.

Sudsnik uses queues everywhere because of the premise. A habitat is in contact for ten minutes of every
ninety-minute orbit. A call that has to be answered now cannot be made to something that is behind the Earth.

## 2. Watch one message do its work

Place an order for a pod you have not used, put its id in `ORDER` the way [`05-caches.md` §2](05-caches.md) does, and read it
straight back. Then read it again after twenty seconds:

```sh
curl -s "http://127.0.0.1:4000/v1/orders/$ORDER" -H "Authorization: Bearer $TOK"
```

```
{"orderId":"01M336CD2C28GKDQGS1X4MDDYE","tenantId":"op1","habitatId":"hab01","podId":"hab01-p042","state":"placed","payment":"pending","placedAt":33240000,"updatedAt":33240000}
```

```
{"orderId":"01M336CD2C28GKDQGS1X4MDDYE","tenantId":"op1","habitatId":"hab01","podId":"hab01-p042","state":"washing","payment":"pending","placedAt":33240000,"updatedAt":43200000,"shuttleId":"sh5","nodeId":"B","holdId":"01M336CX5KYTK48W021AMAK0ZG"}
```

Nobody sent a request in between. The order acquired a shuttle, a node and a hold, and reached `washing`, and the
only thing you did was wait. Twenty seconds of your time is about two orbits of Sudsnik's, so how far yours gets
depends on when in the link window you placed it; anywhere from `scheduled` to `washed` is normal.

## 3. Read the bus

```sh
sqlite3 data/bus.sqlite '.tables'
```

```
cursors       dead_letters  deliveries    messages      topic_use   
```

```sh
sqlite3 -header -column data/bus.sqlite \
  "select seq, topic, publisher from messages where payload like '%$ORDER%' order by seq;"
```

```
seq   topic             publisher
----  ----------------  ---------
1256  order.placed      orders   
1257  pickup.scheduled  dispatch 
1420  pod.collected     dispatch 
1624  pod.delivered     dispatch 
1629  hold.acquired     washnodes
1632  wash.started      washnodes
```

That is the whole of what happened, in order, by whom. `orders` published one message and stopped thinking about
it. Everything after line one was some other service reacting, and reacting to reactions. The `seq` numbers are
the bus's own ordering; yours will be different numbers, and the gaps are every other message from every other
order, plus the simulator's clock tick every simulated minute. The six topics and their order are the fixed
part.

The payload is the message's own data:

```sh
sqlite3 data/bus.sqlite \
  "select payload from messages where topic='order.placed' order by seq desc limit 1;" | jq .
```

```json
{
  "orderId": "01M336CD2C28GKDQGS1X4MDDYE",
  "habitatId": "hab01",
  "podId": "hab01-p042",
  "requestedAt": 33240000
}
```

Its shape is a schema like any other, in `packages/contracts/src/events/order.placed.ts`. Events are contracts
too, and they belong to the bus rather than to the service that publishes them, because every consumer needs
them.

## 4. Who is listening

The bus counts every publish and every consume:

```sh
sqlite3 -header -column data/bus.sqlite \
  "select service, direction, count from topic_use where topic='order.placed' order by direction, service;"
```

```
service   direction  count
--------  ---------  -----
dispatch  consume    4    
notify    consume    4    
orders    publish    4    
```

The counts are every `order.placed` since the stack started, so mine says 4 and yours will say however many
orders you have placed. The three rows are the point.

Two services acted on your order without `orders` knowing either of them exists. `dispatch` scheduled a pickup.
`notify` wrote a notification, which you can see for yourself:

```sh
sqlite3 -header -column data/notify.sqlite "select template, state from notifications where order_id='$ORDER';"
```

```
template          state    
----------------  ---------
order.placed      delivered
pickup.scheduled  delivered
```

This is what "loosely coupled" buys and costs. Adding a third consumer needs no change to `orders`. But nothing
in `orders` can tell you whether anybody acted, the order's state is behind reality for as long as delivery
takes, and a message can arrive twice or out of order, which is why every handler in this system has to be
idempotent (`docs/system-spec.md` §5.1, rule 6). Weeks 4 and 6 are that sentence in full.

## 5. Exercise

Compare what the system did with what it is allowed to do.

The measured side is the `topic_use` query in §4. The declared side is `declaredTopics` in
`packages/contracts/src/topics.ts`:

```sh
node --import tsx -e 'import("@sudsnik/contracts").then(m=>{for(const[s,v]of Object.entries(m.declaredTopics))if(v.consumes.includes("order.placed"))console.log(s)})'
```

```
dispatch
notify
```

The `--import tsx` is not optional; without it `node` refuses to load a `.ts` file.

Now do the same for `pickup.scheduled`. Its `topic_use` row has three consumers, and one of the three is a
service neither §3 nor §4 of this page has mentioned. Name it, then say from `docs/system-spec.md` §9 what it
does with a pickup it neither requested nor scheduled.

Then find the file in that service that handles the topic. It is named after the topic, it sits beside five
siblings named after five more, and nothing in the repository imports any of them. `docs/system-spec.md` §5.5
under `Handler` says how they ever get run.
