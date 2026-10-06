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
- [Projections](./aggregates/projections.spec.md): read models derived from
  aggregates' stored state.
- [Monitors](./aggregates/monitors.spec.md): observers that assert rules about
  events.

## The aggregate

- An aggregate declaration MUST name the aggregate's kind and declare its
  identity, its fields, its commands, its events, and its state machine.
- Every aggregate of a kind MUST have a distinct identity, and an aggregate's
  identity MUST NOT change.
- An aggregate is reached only through its root: the aggregate as a whole.
  Nothing outside an aggregate MAY hold a reference to a part of it.
- An aggregate's state is stored: its machine state and its version, the number
  of events that have changed it. The stored state is the source of truth for
  the aggregate.
- An aggregate's state MUST change only by evolving it by the events of an
  accepted command. No other mechanism changes it.

## Handling a command

Handling a command is one transaction on one aggregate:

1. **Load.** Read the aggregate's stored state and its version. An aggregate
   with no stored state has the initial state and version zero.
2. **Decide.** The state machine decides the command against the current state.
   The decision either rejects the command, with a reason, or emits zero or more
   events.
3. **Evolve.** Evolve the current state by the emitted events, in order, to get
   the new state.
4. **Check.** Check the new state against the aggregate's field patterns and
   invariants. If it does not satisfy them, the command MUST be rejected.
5. **Save.** Store the new state, with its version increased by the number of
   events, on the condition that the stored version is still the one read at the
   load step. In the same transaction, record the emitted events for delivery.

- A command MUST change at most one aggregate.
- If any step fails, nothing MUST be saved and no event MUST be recorded: a
  command's new state and its events are saved together or not at all.
- A command sent to an identity with no stored state is handled by the state
  machine's start state, with the initial state. This is how aggregates are
  created.

## Outcomes

Handling a command ends in exactly one outcome, reported to the manager that
sent it:

- **Accepted**, with the new state saved and its events recorded. An accepted
  command MAY have emitted no events, when its handler emits none; then the
  state and its version are unchanged.
- **Rejected**, with the reason. Nothing was saved. A rejection is a normal
  business outcome, not an error.
- **Conflicted**: concurrent commands kept changing the aggregate, and the
  runtime gave up retrying (see [concurrency](#concurrency)). Nothing was saved.

## Events after saving

An event exists to tell the rest of the program about a change. It is not kept
as history.

- Every event recorded by a save MUST be delivered, at least once, to every
  reactor and monitor that observes it (see the overview's
  [modes](./overview.spec.md#modes)). Recording events in the same transaction
  as the state, and delivering them from that record afterwards, is what makes
  this possible: a process that stops between saving and delivering delivers
  them when it resumes.
- Once an event has been delivered to everything that observes it, the runtime
  MAY discard it. Nothing in a program MAY read an event after it has been
  delivered.
- Aggregates are never rebuilt from events. To repeat the effect of an event, a
  manager or reactor sends another command, which emits another event.

## Concurrency

Concurrency is optimistic: commands on the same aggregate are not locked against
each other, and conflicts are detected when the new state is saved.

- A save MUST succeed only if the stored version is the one the decision was
  made against. Otherwise it MUST fail without saving anything.
- When a save fails this way, the runtime MUST handle the command again from the
  load step, deciding it against the state as it now is.
- Handling again MAY end in a different outcome than the first attempt would
  have: the command may now be rejected, or emit different events.
- The runtime MUST stop after a bounded number of attempts and report the
  command as conflicted.
- Creating an aggregate is covered by the same rule: the expected version of an
  aggregate with no stored state is zero, so two commands racing to create one
  aggregate cannot both succeed.

## Determinism

- Deciding and evolving MUST be pure and deterministic: the same state and the
  same command or event MUST always produce the same result.
- Anything nondeterministic that a decision needs, such as the current time or a
  new identity, MUST arrive in the command.
- Because decisions are deterministic, handling a command again after a conflict
  is always safe: no attempt has any effect except the final save.

## Open questions

- **The retry bound.** Whether the number of attempts is fixed by the runtime,
  set in config, or declared per aggregate.
- **Changing an aggregate's shape.** Stored states outlive the version of the
  program that saved them. How a program that changes an aggregate's fields,
  states, or invariants brings existing stored states along, and what happens to
  a stored state the new program does not accept (see
  [fields](./aggregates/fields.spec.md#invariants)).
