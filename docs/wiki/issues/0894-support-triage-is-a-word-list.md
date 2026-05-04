# #894 — support triage is a word list and crews have noticed

**State** open · **Labels** support, quality · **Opened** Leslie Lamport, 2026-03-21

"burning smell, pod is warm to touch" came back `category: odor, severity: low, action: clean`. The word
`smell` is in the odor list and nothing looks at the rest of the sentence.

The triage is a keyword matcher. It was meant to be the thing we shipped while the real one was designed, and
that was in January.

## Comments

**Barbara Liskov** — It is right often enough that nobody escalated it, which is the worst place for a thing like
this to sit.

**Leslie Lamport** — We have an account with a model provider and a client for it already, metered like everything
else. What we do not have is any way of knowing whether a replacement is better than the word list.

**Barbara Liskov** — Then that is the first piece of work, not the model. Keyed fixtures, precision and recall
against them, run before and after.

**Leslie Lamport** — And a budget. Tokens are priced in the meter and a triage per anomaly report at peak is not free.

**Radia Perlman** — One more thing for whoever does it. The note is crew free text and it goes into the prompt.
Assume somebody writes instructions in it, because somebody will.
