# Aggregates

This chapter defines aggregates: what one is, how it handles a command, and how
concurrent commands on the same aggregate are resolved. Its subtopics define an
aggregate's parts. Terms are defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Subtopics

- [Fields](./aggregates/fields.spec.md): an aggregate's state, and its
  invariants.
- [Commands and events](./aggregates/commands-and-events.spec.md): what an
  aggregate accepts and what it records.
- [State machines](./aggregates/state-machines.spec.md): how an aggregate
  decides and evolves.
- [Relationships](./aggregates/relationships.spec.md): references between
  aggregates, and the entities inside one.
- [Projections](./aggregates/projections.spec.md): read models built from
  events.
- [Monitors](./aggregates/monitors.spec.md): observers that assert rules about
  events.

## The aggregate

- An aggregate declaration MUST name the aggregate's kind and declare its
  identity, its fields, its commands, its events, and its state machine.
- Every aggregate of a kind MUST have a distinct identity, and an aggregate's
  identity MUST NOT change.
- An aggregate is reached only through its root: the aggregate as a whole.
  Nothing outside an aggregate MAY hold a reference to a part of it.
- An aggregate's state MUST be exactly the result of evolving its initial state
  by each event in its stream, in order. No other mechanism changes it.

## Handling a command

Handling a command is one transaction on one aggregate:

1. **Load.** Read the aggregate's stream, and note its version: the number of
   events in it.
2. **Rebuild.** Evolve the initial state by each event, in order, to get the
   current state.
3. **Decide.** The state machine decides the command against the current state.
   The decision either rejects the command, with a reason, or emits zero or more
   events.
4. **Check.** Evolve the current state by the emitted events, and check the
   result against the aggregate's field patterns and invariants. If the result
   does not satisfy them, the command MUST be rejected.
5. **Append.** Append the emitted events to the stream, on the condition that
   its version is still the one noted at the load step.

- A command MUST change at most one aggregate.
- If any step fails, no event MUST be appended: a command's events are appended
  all together or not at all.
- A command sent to an identity whose stream is empty is handled by the state
  machine's start state, with the initial state. This is how aggregates are
  created.

## Outcomes

Handling a command ends in exactly one outcome, reported to the manager that
sent it:

- **Accepted**, with the events appended. An accepted command MAY have appended
  no events, when its handler emits none.
- **Rejected**, with the reason. Nothing was appended. A rejection is a normal
  business outcome, not an error.
- **Conflicted**: concurrent commands kept changing the aggregate, and the
  runtime gave up retrying (see [concurrency](#concurrency)). Nothing was
  appended.

## Concurrency

Concurrency is optimistic: commands on the same aggregate are not locked against
each other, and conflicts are detected when events are appended.

- An append MUST succeed only if the stream's version is the one the decision
  was made against. Otherwise it MUST fail without appending anything.
- When an append fails this way, the runtime MUST handle the command again from
  the load step, deciding it against the stream as it now is.
- Handling again MAY end in a different outcome than the first attempt would
  have: the command may now be rejected, or emit different events.
- The runtime MUST stop after a bounded number of attempts and report the
  command as conflicted.
- Creating an aggregate is covered by the same rule: the expected version of a
  new stream is zero, so two commands racing to create one aggregate cannot both
  succeed.

## Determinism

- Deciding and evolving MUST be pure and deterministic: the same state and the
  same command or event MUST always produce the same result.
- Anything nondeterministic that a decision needs, such as the current time or a
  new identity, MUST arrive in the command.
- Because decisions are deterministic, handling a command again after a conflict
  is always safe: no attempt has any effect except the final append.

## Open questions

- **The retry bound.** Whether the number of attempts is fixed by the runtime,
  set in config, or declared per aggregate.
- **Snapshots.** Long streams make rebuilding slow. Whether the runtime may
  cache a state at a stream version, and how such a cache is invalidated when
  the program changes.
