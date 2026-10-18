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
- [Errors](./errors.spec.md): error kinds and occurrences retained as part of an
  aggregate's machine state.

## The aggregate

- An aggregate declaration MUST name the aggregate's kind and declare its
  identity, its fields, its commands, its events, and its state machine.
- An aggregate MAY declare modeled error kinds. Their occurrences MUST be stored
  as part of its machine state and changed only through evolving its events (see
  [errors](./errors.spec.md)).
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
4. **Check.** Check the new state against the aggregate's field patterns,
   modeled error constraints, and invariants. If it does not satisfy them, the
   command MUST be rejected.
5. **Save.** Store the new state, with its version increased by the number of
   events, on the condition that the stored version is still the one read at the
   load step. In the same transaction, record the emitted events and any
   manager-attached messages for delivery (see
   [queues](./queues.spec.md#sending)). A zero-event decision saves nothing and
   enqueues no messages.

- A command MUST change at most one aggregate.
- A command's new state, events, and any manager-attached messages MUST be saved
  together or not at all. A step that fails before commit MUST save nothing.
  When Save's commit result is unknown, the command MUST fail with a warning
  that its change and messages may stand (see
  [runtime](./runtime.spec.md#outcomes)).
- A command sent to an identity with no stored state is handled by the state
  machine's start state, with validated explicit creation values or declared
  initializers for ordinary fields. Its identity is the validated supplied
  address. This is how aggregates with known identities are created (see
  [Types](./types.spec.md#aggregate-identities)); repository-assigned-at-insert
  creation requires a separately specified protocol.

## Outcomes

Handling a command ends in exactly one outcome, reported to the manager that
sent it:

- **Accepted**, with the new state saved and its events recorded. An accepted
  command MAY have emitted no events, when its handler emits none; then the
  state and its version are unchanged, and no messages are enqueued.
- **Rejected**, with the reason. Nothing was saved. A rejection is a normal
  business outcome, not an error.
- **Conflicted**: concurrent commands kept changing the aggregate, and the
  runtime gave up retrying (see [concurrency](#concurrency)). Nothing was saved.
- **Failed**, with an error: handling met a defect in the program, such as a
  failed expression (see [expressions](./expressions.spec.md#failure)) or a
  stored state the program no longer accepts (see
  [fields](./aggregates/fields.spec.md#invariants)) or a failed storage call.
  Nothing was saved unless Save committed but its result could not be learned;
  then the error MUST say that the change and messages may stand. Unlike a
  rejection, a failure is not a business outcome.

## Events after saving

An event exists to tell the rest of the program about a change. Once delivered,
it is not part of the program's working state.

- Every event recorded by a save MUST be delivered, at least once, to every
  reactor and monitor that observes it (see the overview's
  [modes](./overview.spec.md#modes)). Recording events in the same transaction
  as the state, and delivering them from that record afterwards, is what makes
  this possible: a process that stops between saving and delivering delivers
  them when it resumes.
- Once an event has been delivered to everything that observes it, the runtime
  MAY discard it. Nothing in a program MAY read an event after it has been
  delivered.
- Keeping events, for example for auditing or backups, is an ordinary reaction:
  a reactor the program declares, which passes events to a service the
  implementor provides. Coleslaw does not specify where or how events are kept,
  or how they might be used to recover.
- Aggregates MUST NOT be restored by replaying events: they are loaded from
  their stored state. To repeat the effect of an event, a manager or reactor
  sends another command, which emits another event.

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
  command as conflicted (see [runtime](./runtime.spec.md#the-retry-bound)).
- Creating an aggregate is covered by the same rule: the expected version of an
  aggregate with no stored state is zero, so two event-emitting commands racing
  to create it cannot both save against version zero. A zero-event accepted
  command creates no stored aggregate.

## Determinism

- Deciding and evolving MUST be pure and deterministic: the same state and the
  same command or event MUST always produce the same result.
- Anything nondeterministic that a decision needs, such as the current time or a
  new identity, MUST arrive in the command.
- Because decisions are deterministic, handling a command again after a conflict
  is always safe: no attempt has any effect except the final save.

## Open questions

- **Changing an aggregate's shape.** Stored states outlive the version of the
  program that saved them. How a program that changes an aggregate's fields,
  states, or invariants brings existing stored states along, and what happens to
  a stored state the new program does not accept (see
  [fields](./aggregates/fields.spec.md#invariants)).
