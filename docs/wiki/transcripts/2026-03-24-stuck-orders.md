# #eng-sudsnik — 2026-03-24, the evening 316 orders stopped

**16:41 Grace Hopper**
quiet-orbit just came back with 316 stuck. it was 0 this morning.

**16:41 Grace Hopper**
they're all in `scheduled`. pickup published, never collected.

**16:44 Margaret Hamilton**
holds?

**16:46 Grace Hopper**
183 of 270 expired. every one of them expired before the pod got anywhere near a node.

**16:47 Margaret Hamilton**
how long is a hold

**16:47 Grace Hopper**
one orbit

**16:47 Margaret Hamilton**
and how long is the transit

**16:48 Grace Hopper**
...one orbit

**16:48 Margaret Hamilton**
right

**16:52 Grace Hopper**
ok so the hold is acquired at scheduling and the pod arrives exactly when it expires. it's a coin flip and we're
losing most of them.

**16:53 Margaret Hamilton**
why do we hold at scheduling at all

**16:55 Grace Hopper**
so we know a washer will be free before we commit the launch

**16:56 Margaret Hamilton**
but we don't know that. we can't know that across an orbit. whatever we reserve now might be gone by the time the
pod lands, and in the meantime we're holding a washer nobody can use.

**16:57 Margaret Hamilton**
in the actual world nothing is reserved while a pod is in transit. the washer is just sitting there.

**17:02 Grace Hopper**
so hold on arrival, and don't publish pod.delivered until we have one

**17:02 Margaret Hamilton**
yes

**17:03 Grace Hopper**
that changes what pod.delivered means. it stops being "the shuttle got there" and starts being "the pod is at a
washer we own"

**17:04 Margaret Hamilton**
which is the thing anyone downstream actually cares about

**17:31 Grace Hopper**
rerun: 0 stuck. hold attempts per order went 29 -> 2.17.

**17:32 Leslie Lamport**
29?!

**17:33 Grace Hopper**
we were also retrying every minute. that's a separate thing, fixing it next.

**17:33 Leslie Lamport**
please write this one down somewhere
