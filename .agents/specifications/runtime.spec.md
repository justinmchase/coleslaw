# Runtime

This chapter defines what the runtime does with a program's aggregates, events,
and queued messages: how it stores aggregate state, handles commands, retries
conflicts, records events and outbox messages, and delivers them. It consolidates
what the [aggregates](./aggregates.spec.md), [reactors](./reactors.spec.md),
[services](./services.spec.md), and [startup](./startup.spec.md) chapters
promise about the runtime, and makes it precise. Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Stored state, not event sourcing

- The runtime MUST store each aggregate as its stored state: its machine state
  and its version. The stored state is the source of truth for the aggregate
  (see the overview's [execution model](./overview.spec.md#execution-model)).
- Machine state MUST include any modeled error occurrences, active or resolved.
  They are saved with that state, not in a separate error store (see
  [errors](./errors.spec.md)).
- The runtime MUST NOT restore, rebuild, or check an aggregate by replaying
  events. Loading an aggregate reads its stored state and nothing else.
- An aggregate kind is identified by its context's name and its own name (see
  [declaring a context](./modules.spec.md#declaring-a-context)). The runtime
  MUST keep the stored states and events of different kinds apart, so two
  contexts' aggregates named `Product` never mix.
- An aggregate is identified by its kind and its identity. Two identities are
  the same when they are equal as data (see
  [patterns as types](./patterns-as-types.spec.md#equality)).

## Handling a command

The runtime handles a command in the five steps the aggregates chapter defines
(see [handling a command](./aggregates.spec.md#handling-a-command)). This
section says what each step reads and writes.

1. **Load.** Read the aggregate's stored state and version from the state store
   (see [runtime services](#runtime-services)). An aggregate with no stored
   state has the initial machine state and version zero. A loaded state that
   fails a field pattern, modeled error constraint, or invariant ends the
   command as failed (see
   [fields](./aggregates/fields.spec.md#invariants)).
2. **Decide.** Match the command's payload against its pattern, then run the
   state machine's command handler against the loaded state. A payload that does
   not match, or a decision to reject, ends the command as rejected.
3. **Evolve.** Evolve the loaded state by the decided events, in the order they
   were emitted, to get the new state.
4. **Check.** Check each emitted event's payload against its pattern, and the
   new state against the field patterns, modeled error constraints, and
   invariants. A failure ends the command as rejected, with a reason naming
   what failed.
5. **Save.** Ask the state store to store the new state with its version
   increased by the number of events, on the condition that the stored version
   is still the one loaded, and in the same transaction to record an event
   record for each event and any messages the manager enqueues (see
   [recording events](#recording-events) and
   [outbox messages](#outbox-messages)).

- Load and Save MUST be the only steps that touch storage. Decide, Evolve, and
  Check MUST be pure computations over the loaded state and the command.
- Save MUST be atomic: the new state, every one of its event records, and every
  message the manager enqueues are stored together, or nothing is. Events and
  messages wait in the same store as the state until they are relayed.
- Save MUST succeed only if the stored version equals the version loaded. For an
  aggregate with no stored state the loaded version is zero, so of two commands
  emitting events and racing to create one aggregate at most one saves against
  version zero.
- A decision accepted with no events MUST save nothing and record nothing,
  including no messages attached by its manager. It cannot conflict, and its
  outcome is accepted with the version loaded.
- Before Save, the runtime MUST validate any messages that will be enqueued
  against their queue shapes and compute their order-group keys and records.
  A failure MUST fail the command before anything is committed. A conflicted
  attempt MUST leave no event or message records behind.
- Between one command's Load and its Save, other commands MAY save the same
  aggregate. Nothing is locked; a conflict is detected at Save (see
  [concurrency](./aggregates.spec.md#concurrency)).

## Outcomes

Handling a command ends in exactly one of the outcomes the aggregates chapter
defines (see [outcomes](./aggregates.spec.md#outcomes)). This section says which
step produces each.

- **Accepted**: Save succeeded, or the decision emitted no events. The outcome
  carries the events emitted and the aggregate's new version.
- **Rejected**: the payload did not match, the decision rejected, or Check
  failed. Nothing was saved.
- **Conflicted**: Save failed because the stored version had changed, on every
  attempt the [retry bound](#the-retry-bound) allows. Nothing was saved.
- **Failed**: a defect in the program, such as a failed expression or a loaded
  state the program no longer accepts, or a failed call to a runtime service.
  Nothing was saved, except as the next rule allows.
- When the runtime cannot learn whether a Save took effect, such as when the
  state store times out after committing, the outcome MUST be failed, and its
  error MUST say that the change may stand. If it stands, its events and
  messages were recorded and are delivered like any other.
- A command's outcome is fixed when its last attempt ends. Reactions to its
  events MUST NOT affect it, and the runtime MUST NOT wait for reactions before
  reporting it.

## The retry bound

A conflict means the decision was made against a state that is no longer
current. Because deciding is deterministic and has no effects, deciding again
against the current state is always safe (see
[determinism](./aggregates.spec.md#determinism)).

- When Save fails with a conflict, the runtime MUST handle the command again
  from Load: the whole cycle of Load, Decide, Evolve, Check, and Save runs again
  against the state as it now is. Nothing from the earlier attempt is reused.
- An attempt after a conflict MAY end in any outcome, including rejected or
  accepted with different events.
- Only a conflict is retried. A rejected or failed attempt MUST end the command
  at once with that outcome.
- The built-in setting `commandAttempts` MUST give the greatest number of
  attempts, counting the first, that the runtime makes to handle one command. It
  is a whole number, at least `1`, and defaults to `3`; it is read as any
  setting is (`--command-attempts 5`, or `COMMAND_ATTEMPTS=5` in the
  environment; see [config](./config.spec.md#names-in-each-source)). A value of
  `1` means a conflict is never retried.
- When the last allowed attempt conflicts, the command MUST end as conflicted.
- The retry bound applies to every command the runtime handles, whichever
  manager or reaction sent it. The sender sees only the final outcome, as the
  result of its step; the attempts are not steps of its state machine.
- The runtime MAY wait between attempts. How long it waits MUST NOT change what
  any attempt decides.

## Other repeats

Retrying a conflicted command is the only repeat of program work the runtime
makes within one invocation. Relay and delivery are at least once.

- The runtime MUST NOT retry a failed service call, including a call to a
  runtime service, as another step of the same invocation (see
  [services](./services.spec.md#failure)). A later relay or delivery attempt
  MAY call that service again for a record left pending.
- A failed reaction MUST be run again from its start state when its event is
  delivered again, not resumed from the step that failed (see
  [reactors](./reactors.spec.md#repeats)).
- A manager operation is never run again by the runtime. An entry point that
  delivers at least once, such as a consumer, MAY invoke it again (see
  [managers](./managers.spec.md#invoked-more-than-once)).

## Recording events

- Save MUST record, for each emitted event, the event record the commands and
  events chapter lists: the aggregate's kind and identity, the event's name and
  payload, its shard key, its version, and the time it was recorded (see
  [event records](./aggregates/commands-and-events.spec.md#event-records)).
- An event's version MUST be the aggregate's version once that event has been
  evolved, so the events of one Save have consecutive versions ending at the new
  version.
- The recorded time MUST come from the clock service (see
  [provided services](./services.spec.md#provided-services)), read once per
  attempt and shared by every event that attempt records.
- An event is identified by its aggregate's kind and identity and its version.
  Because Save is conditional on the version, at most one event is ever recorded
  with a given identification, so two deliveries with the same identification
  are the same event delivered twice.
- An event's shard key MUST be computed when it is recorded: by its event
  declaration's shard key if it has one, otherwise by its aggregate's, otherwise
  as its aggregate kind, its name, and its aggregate's identity (see
  [order](./reactors.spec.md#order)). A shard key MUST be data, and two shard
  keys are the same when they are equal as data.
- A shard key expression that fails ends the command as failed, as any failed
  expression does (see [expressions](./expressions.spec.md#failure)).
- The state store MUST give the records with one shard key a single order, the
  record order: version order within one aggregate, and the order their Saves
  committed across aggregates.

## Delivering events

An event exists to tell what observes it about a change. The runtime delivers it
from the record Save made, then lets it go. This section applies to internal
aggregate events. External delivery follows
[external events](./reactors.spec.md#external-events); external-event reactors
are not destinations of this relay.

- Every recorded event MUST be delivered at least once to every reactor and
  monitor that observes it (see
  [events after saving](./aggregates.spec.md#events-after-saving)). The runtime
  MUST NOT promise exactly once, whatever its services offer.
- Delivery MUST start only after the Save that recorded the event has committed.
  No reaction runs inside the transaction of the command whose event it reacts
  to.
- The runtime relays each record from the state store to its destinations: each
  observer that runs in the saving process, and the event source when the config
  sends events to one (see the overview's [modes](./overview.spec.md#modes)).
  The config, not the program, MUST decide which reactors run in process and
  which run in events mode.
- A record MUST stay in the state store until every destination has completed
  it. An in-process reactor completes a record when its reaction reaches a final
  state; the event source completes it when it has accepted it.
- An event source MUST then deliver the record to each reactor that runs in
  events mode, and MUST keep it until that reactor's reaction completes.
- A process that stops before a destination completes a record MUST leave it
  pending, and the record MUST be delivered to that destination again when
  relaying resumes, by that process or another sharing the store (see
  [stopping](./modes.spec.md#stopping)). This is the source of repeats.
- Once every destination has completed a record, the state store and the event
  source MAY discard it. Nothing in a program MAY read an event after it has
  been delivered.

### Order

- Records with the same shard key MUST reach each reactor in record order, and a
  reactor MUST complete its reaction to one before it receives the next (see
  [order](./reactors.spec.md#order)).
- When a reaction fails, delivery of that shard key to that reactor MUST resume
  from the failed record.
- Nothing else is ordered. Records with different shard keys MAY reach a reactor
  in any order, and MAY be handled at the same time.
- Each reactor's delivery MUST be independent of every other's. A reactor MAY
  run in another process, and MAY be ahead of or behind another reactor, whether
  it runs in process or in events mode.
- Relaying MUST preserve this order even when several processes share one state
  store or one event source. How they divide the work is the implementations'
  choice.

### What a reaction receives

- A reaction MUST receive the event's payload and its whole record.
- When a reaction calls an effect, the runtime MUST make the causing event's
  identification, its aggregate's kind and identity and its version, available
  to the implementation, together with the reactor's context and name, the
  calling state, and its visit count, so the implementation can distinguish
  repeated steps from separate calls (see
  [effects and repeats](./services.spec.md#effects-and-repeats)).

## Outbox messages

The state store is the durable outbox for messages. The runtime relays them to
the queue implementation only after their outbox record is committed.

- A manager's message record MUST be committed atomically with the command it
  enqueues it with, and only when the command emits at least one event. A
  rejected, conflicted, or zero-event accepted command MUST leave no messages
  in the outbox. A failure known not to have committed MUST leave no messages;
  an unknown commit result follows [outcomes](#outcomes).
- A reaction's message record MUST be committed before its send step completes.
  A failure after that point MUST NOT remove the message; a repeated reaction
  may enqueue the same logical message again with the same identity (see
  [message identities](./queues.spec.md#messages)). If the commit result is
  unknown, the reaction MUST fail with a warning that its message may stand.
- The outbox MUST retain each message until its queue implementation has
  accepted it. If relay fails or its result is unknown, the runtime MUST retry
  with the same message identity.
- A queue implementation MUST tolerate receiving the same message identity
  more than once. It MAY suppress duplicate submissions or accept separate
  queue items with that identity. Neither the relay nor the queue promises
  exactly-once delivery or permanent duplicate suppression (see
  [queues](./queues.spec.md#delivery)).
- A message MUST NOT be delivered to its consumer before its outbox record is
  committed.
- The relay MUST preserve outbox commit order for messages in the same queue
  order group, including the declaration order of messages committed together.
  It MUST NOT advance to a later distinct message until acceptance of the
  preceding one is confirmed, even if several processes share the outbox.

## Keeping events

- The runtime MUST NOT keep events after delivery for any purpose of its own: no
  history, no replay, no recovery.
- A program that wants events kept, for auditing or backups, MUST do so with an
  ordinary reactor that passes them to a service the implementor provides.
  Coleslaw does not specify where or how they are kept, and nothing restores an
  aggregate from them.

## Projections

- A projection MUST be derived from the stored states it declares, never from
  events (see [projections](./aggregates/projections.spec.md#behavior)).
- After a Save, the runtime MUST bring each projection that derives from the
  saved kind up to date with the new stored state. A projection MAY lag, and
  MUST record which version of each aggregate it reflects.
- The state store MUST be able to give every stored state of a kind, so that the
  runtime can rebuild any projection from the current stored states alone.

## Storing data

- Every value the runtime stores or delivers is data (see
  [data](./patterns-as-types.spec.md#data)), and MUST read back as an equal
  value of the same type (see [storage](./patterns-as-types.spec.md#storage)).
- Values MUST cross a runtime service boundary as data, not encoded. Each
  implementation chooses how it encodes them for its technology, and its
  encoding MUST round-trip every type of data.
- Coleslaw MUST provide a standard encoding of data as text, which
  implementations MAY use. It MUST round-trip every type of data, and MUST give
  the same text for the same value every time.
- Data the runtime gives a program MUST be a tree: no object in it is shared
  with another value. An in-memory implementation MUST copy data when it stores
  it and when it gives it back.

## Runtime services

The runtime's own needs are services, like any other, so that the program names
no technology for them and the config chooses their implementations.

- Coleslaw MUST declare the runtime services itself, naming no technology:
  - **State store**: loads an aggregate's stored state and version; saves a new
    state with its event records and manager-enqueued messages, atomically and
    on the condition of the version, giving either saved or conflicted; appends
    reaction-enqueued messages durably; gives pending events and messages to
    the relay in record order per shard key or queue order group; marks them
    complete for a destination; and gives every stored state of a kind.
  - **Event source**: accepts internal event records from the relay, and
    delivers them to each internal-event reactor in events mode, in record
    order per shard key, until that reactor completes each one.
  - **Message broker**: the runtime's queue capability, provided through the
    selected implementation of each reached queue. It accepts relayed outbox
    messages and delivers them to the one consumer of that queue, respecting
    leases, dispositions, and order groups (see [queues](./queues.spec.md)).
  - **External event source**: gives external-event reactors declared events
    with their payload, source identity, stable event identity within that
    source, and delivery count. Its implementation is configured at the
    program's boundary (see
    [external events](./reactors.spec.md#external-events)).
- Only the runtime MAY call a runtime service's operations. No declaration in a
  program MAY call them.
- Coleslaw MUST provide an in-memory implementation of each runtime service, so
  a program runs locally, in one process, with no technology chosen (see
  [startup](./startup.spec.md#services)).
- Which implementation a process uses MUST be chosen by its config, as for any
  service, so the same program runs in memory locally and on a database and a
  broker in production.
- A runtime service MUST be constructed only when the selected mode reaches it:
  the state store when the mode handles commands or relays records, the event
  source when the mode publishes internal events or runs internal reactors in
  events mode, the message broker when the mode sends or consumes queue
  messages, and an external event source when the mode runs a reactor for it.
- A failed call to a runtime service is a failure, not an outcome the program
  handles: a command whose Load or Save fails ends as failed, and a relay or
  delivery step that fails leaves its record pending.

## Checkability

The runtime is part of what a checker runs, so it must vary only where the
checker can choose (see the overview's
[checkability](./overview.spec.md#checkability)).

- Every source of variation in the runtime MUST be a choice at the program's
  edge that a checker can make:
  - which command arrives next, and from which entry point or reaction;
  - how attempts on the same aggregate interleave, where each attempt's Load and
    Save are separate points, so a checker chooses which saves fall between them
    and so whether a Save conflicts;
  - what each service returns, including the clock, identities, and the runtime
    services;
  - which pending record is delivered next to which destination, whether a
    delivered record is delivered again, whether a relay accepts duplicate
    copies, and where a process stops;
  - when a queue lease expires, whether a disposition commits, and whether a
    storage or broker call commits but reports an unknown result.
- Everything else the runtime does MUST be deterministic: given the same choices
  at those edges, a run MUST take the same path and give the same outcomes,
  versions, records, and shard keys.
- The in-memory implementations MUST let a checker make these choices, or be
  replaceable by implementations that do.

## Open questions

- **Retry bound per aggregate.** Whether an aggregate, or a command, may declare
  its own bound on attempts in place of `commandAttempts`.
- **Waiting between attempts.** Whether the runtime backs off between attempts,
  and whether how it does so is a setting.
- **Records that never complete.** A reaction that fails every time keeps its
  record pending forever and holds up its shard key; how the runtime notices,
  and where the record goes (see [reactors](./reactors.spec.md#open-questions)).
- **Projection storage.** Whether projections are kept by the state store or by
  a runtime service of their own, and whether a projection is brought up to date
  in the transaction of the Save or after it.
- **In-process delivery across processes.** When several processes share a
  durable state store and run reactors in process, which of them relays to each
  in-process reactor, and what happens to records for a reactor no running
  process reaches.
- **The standard encoding.** The exact text format of the standard encoding of
  data, and whether it is required of implementations that share stored data or
  records with other implementations.
- **Operation signatures.** The exact declarations of the runtime services'
  operations, and whether their kinds, query or effect, mean anything when only
  the runtime calls them.
