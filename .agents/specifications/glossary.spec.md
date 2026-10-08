# Glossary

This chapter defines Coleslaw's vocabulary. Every chapter, and every keyword in
the language, uses these terms with these meanings. Most come from domain-driven
design; a few come from the P language's state machines.

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Using the glossary

- A chapter MUST use a term from this glossary only with the meaning given here.
- A keyword that names one of these concepts MUST be the term itself (for
  example `aggregate`, `event`, `command`).
- A new concept MUST be added here before a chapter relies on it.

## Structure

- **Program**: the set of modules that make up one application.
- **Module**: one Coleslaw source file.
- **Context**: a bounded context. A declaration naming a part of the program
  with its own model of the business, in which each term has a single meaning.
  The same word MAY mean different things in different contexts, and contexts
  integrate only through what each exports, mainly events.
- **Member**: an aggregate, projection, manager, reactor, controller, consumer,
  queue, or job that a context lists, and that belongs to that context alone.
- **Default context**: the unnamed context of every owned declaration that no
  context lists. It exports nothing.
- **Package**: modules published together under one name and version, imported
  as Uffda's packages are. A package MAY export contexts.

## Shapes and values

- **Pattern**: a Uffda pattern. Coleslaw uses patterns as its types.
- **Shape**: a pattern used as a type, such as a field's or a payload's. A value
  has a shape when the shape's pattern matches it, and the value used is the
  value the pattern produces.
- **Data**: a value that survives being stored and read back unchanged:
  `undefined`, `null`, booleans, numbers, bigints, strings, dates, and arrays,
  plain objects, maps, and sets made of data. Everything a program stores is
  data.
- **Value object**: a named shape for a domain value with no identity of its
  own, such as an email address, an amount of money, or a date range. Two value
  objects are equal when their values are equal. Value objects are immutable.
- **Expression**: a Uffda expression. Expressions compute values and have no
  side effects.
- **Func**: a named expression declared in a module, with a pattern its
  arguments must match.
- **Core function**: a function Coleslaw provides to every expression, such as
  `eq` or `deep`. Core functions are pure, and a program cannot add to them.

## Domain

- **Aggregate**: a cluster of domain data treated as a single unit for changes.
  It is the consistency boundary: its invariants hold after every command, and
  one command changes one aggregate.
- **Identity**: the value that distinguishes one aggregate from every other of
  its kind, constant for the aggregate's life.
- **Field**: a named piece of an aggregate's state, with a pattern its value
  must match.
- **Modeled error**: a domain condition retained as data on an aggregate, raised
  and resolved through its commands and events; not a runtime diagnostic.
- **Error kind**: an aggregate-owned declaration of a modeled error, with
  shapes for its occurrence identities and details.
- **Error occurrence**: one identified instance of an error kind with immutable
  details and an active or resolved status. A resolved occurrence remains stored
  so a repeated raise does not reopen it.
- **Raise**: an evolving action that creates an active occurrence if its kind
  and identity are absent, and otherwise leaves the existing occurrence alone.
- **Resolve**: an evolving action that marks an active occurrence resolved.
  An absent or already-resolved occurrence is unchanged.
- **Invariant**: a business rule about an aggregate's state that must hold after
  every command.
- **Relationship**: a reference from one aggregate to another, made by identity.
  A relationship never makes two aggregates one unit of consistency.
- **Command**: a request to change one aggregate, named in the imperative (for
  example `Publish`). It carries a payload, and it may be rejected.
- **Event**: a fact about a change that happened, named in the past tense (for
  example `Published`). It carries a payload. Every change to an aggregate is
  described by an event, which is delivered to what observes it and is then no
  longer part of the program's working state. Events are immutable.
- **Internal event**: an event emitted by an aggregate in this program.
- **External event**: a fact published by another application, in its
  vocabulary, and delivered through a declared event source. It is not an
  aggregate event of this program.
- **Stored state**: an aggregate's machine state and version, as saved by its
  last accepted command. It is the source of truth for the aggregate.
- **Version**: the number of events that have changed an aggregate. Each event's
  version is the aggregate's version once that event has been evolved.
- **Event record**: an event together with what the runtime records with it: the
  aggregate's kind and identity, the event's name, its shard key, its version,
  and the time it was recorded.
- **Shard key**: the key that orders an event's delivery: by default its
  aggregate kind, its name, and its aggregate's identity, or one its aggregate
  or its declaration computes. Events with the same shard key reach each reactor
  in order; nothing else is ordered.
- **Entity**: a value inside an aggregate with an identity unique only within
  that aggregate, such as a line of an order.
- **Outcome**: how handling a command ends: accepted, with its state change,
  events, and any manager-enqueued messages saved; rejected, with a reason;
  conflicted, when concurrent changes outlasted the runtime's retries; or
  failed, with an error, when handling met a defect in the program or a failed
  call to a runtime service. A failed command may have committed when Save's
  result is unknown; its error says that its change and messages may stand.
- **Rejection**: a decision to refuse a command, with a reason. A rejection is a
  normal business outcome, not an error.
- **Conflict**: a save that failed because the aggregate's stored version
  changed after the decision was made.
- **Projection**: a read model derived from the stored states of one or more
  aggregates. A projection can always be rebuilt from those states.
- **Read endpoint**: a named projection read or collection-returning service
  query with shaped inputs, selected results, and declared read limits.
- **Page**: a bounded ordered list of selected items, the total count of
  authorized matching records, and a continuation cursor, or no continuation
  when the read found no more matching items.
- **Cursor**: opaque data identifying an endpoint's saved ordering boundary and
  selection, not a frozen snapshot or permission to read. It contains no total
  count.
- **Nested collection**: a collection selected inside an item or keyed result,
  paged under its own limits and continuation.
- **Query policy**: numeric defaults and limits inherited from Coleslaw,
  optionally overridden by program, config, and endpoint declarations.
- **Full traversal**: following pages until a collection is exhausted; allowed
  only by the selected mode kind's traversal capability.

## State machines

- **State machine**: a set of states, one of them the start state, with handlers
  for the commands and events each state accepts. State machines are the only
  place a Coleslaw program chooses what happens; patterns may still choose
  values.
- **State**: a named condition a state machine is in. A state may have entry and
  exit actions.
- **Handler**: what a state does on receiving a command or an event.
- **Decide**: handling a command. Given the current state and a command, a
  decision emits zero or more events or rejects the command. It changes nothing
  itself.
- **Evolve**: handling an event. Given the current state and an event, evolving
  produces the next state: it may move to another state and set fields.
- **Transition**: a move from one state to another, made while evolving.
- **Start state**: the state a state machine begins in.
- **Final state**: a state with no command handlers, in which every command is
  rejected.
- **Assertion**: a pattern a monitor requires an event and its own state to
  match, with a message reported when they do not.
- **Hot state**: a monitor state the program must not remain in forever.
- **Monitor**: a state machine that observes events and asserts rules about
  them, without side effects, as P's `spec` machines do. A monitor's state may
  be marked hot, meaning the program must not stay in it forever.

## Running

- **Input**: what a process starts with: its command-line arguments, its
  environment variables, and any sources extensions add.
- **Config**: the settings a process runs with, parsed from its input by
  matching it against the program's config declaration.
- **Setting**: one named value of the config, with a shape, taken from the
  command line, the environment, or a source an extension adds.
- **Mode**: one way a program can run: a named declaration of one kind, listing
  the entry points it runs. A program declares one or more modes, one of them
  the default, and each process runs exactly one.
- **API mode**: a mode of the kind that serves requests through controllers
  until stopped.
- **Worker mode**: a mode of the kind that handles messages from queues through
  consumers until stopped.
- **Job mode**: a mode of the kind that runs the one job its input names, then
  exits with that job's outcome.
- **Events mode**: a mode of the kind that handles events from an event source,
  such as a Kafka topic, through reactors until stopped.
- **Implementation**: a module that implements a service declaration for a
  particular technology. The config chooses which implementation a process uses.
- **Application**: what startup constructs from the config for one mode: the
  services, managers, and entry points that mode reaches. The program is the
  source; an application is one running instance of it.
- **Entry point**: how the outside world invokes managers: a controller's routes
  in API mode, consumers in worker mode, jobs in job mode, or reactors in events
  mode.

## Layers

- **Manager**: a set of business operations that entry points invoke.
- **Operation**: one business operation of a manager: it binds its input and
  progresses one aggregate with at most one command. Any further logic is a
  state machine that lasts for the invocation and is never stored.
- **Reactor**: a declaration that reacts to internal events from this program
  or external events from another application. Internal-event reactors may use
  the full reactor capabilities; external-event reactors invoke managers only.
- **Reaction**: one reactor handling one event, by a state machine that lasts
  for the reaction and is never stored. A failed reaction is run again.
- **Event source**: an implementation that supplies internal or external events
  to reactors in events mode. Internal events are accepted from processes that
  save them; external events are supplied by another application's source.
- **Runtime service**: a service Coleslaw declares for the runtime's own needs,
  such as the state store and the event source. Only the runtime calls it; the
  config chooses its implementation, and Coleslaw provides one in memory.
- **State store**: the runtime service that keeps aggregates' stored states and
  the event and message records saved with them until they are relayed.
- **Outbox**: pending event and message records committed in the state store,
  which the runtime relays after commit. Manager messages are saved atomically
  with a command's state and events; reactor messages are appended durably by
  their send steps.
- **Retry bound**: the greatest number of attempts the runtime makes to handle
  one command that keeps conflicting, set by the `commandAttempts` setting.
- **Service**: a capability the program declares and the host program
  implements, such as sending email or charging a card. Services are the edge of
  the program.
- **Query**: a service operation that returns information and changes nothing.
  Managers and internal-event reactors may call queries directly;
  external-event reactors invoke managers only.
- **Effect**: a service operation that changes the world outside the program.
  Only reactors handling internal events may call effects.
- **Controller**: a set of routes by which the outside world invokes managers
  and reads projections, in API mode.
- **Queue**: a program-owned source of internal work messages, handled by
  exactly one consumer. A queue declares its message shape and names no
  technology; managers and internal reactors of its context may enqueue
  messages, and the runtime delivers them in worker mode.
- **Message**: one item enqueued to a program-owned queue. Its value matches the
  queue's declared shape; its identity is derived from the queue and its origin
  and remains stable across repeats of the same send.
- **Queue item**: one copy of a message accepted by the queue implementation.
  Duplicate submissions may create separate items with the same message
  identity. A disposition completes an item, not every possible duplicate copy.
- **Lease**: temporary ownership of one queue item by a process running its
  consumer. An expired lease permits redelivery; it cannot undo work the old
  process already started.
- **Message record**: the message's identity, its origin, the time it was sent,
  its recorded order-group key when declared, and the current queue item's
  delivery count, together with the message itself.
- **Order group**: an optional key declared by a queue from a message. Messages
  first relayed with the same key are delivered in outbox commit order; separate
  duplicate copies may arrive later. Other groups may be handled in any order.
- **Disposition**: how a consumer's handling of a queue item ends: acknowledged,
  so that item is not delivered again; dead-lettered, with a reason; or failed,
  so it is delivered again subject to the redelivery bound. Its result may be
  unknown if the queue implementation cannot confirm it.
- **Dead letter**: where a message goes, with its value, identity, and a reason,
  when the program will not handle it. The program never reads
  dead letters.
- **Redelivery bound**: the greatest number of deliveries of one queue item,
  including its first delivery. A failure at the bound, or a later delivery
  after a lost disposition, dead-letters the item.
- **Consumer**: the one entry point of worker mode that handles a program-owned
  queue's messages by invoking managers, until stopped.
- **Job**: a named unit of work that invokes managers and runs once, in job
  mode, by a state machine that lasts for the run and is never stored. Whatever
  starts the process, such as cron or a migration step, decides when it runs.
  Its arguments are matched against shapes, like any other input.
- **Job argument**: one named value a job starts with, with a shape. It is a
  setting of the config only when its job is the one a job mode runs, named
  under a segment for that job.
- **Route**: a binding from an external request, an HTTP method and path, to a
  manager operation or a projection read.
- **Request**: one HTTP request a route handles. Its path, query string,
  headers, and body are matched against the route's shapes, like any other
  input.
- **Response**: what a route gives for a request: a status, header fields, and a
  body.
- **Pipeline**: an ordered composition of middleware steps and other pipelines
  around a controller's routes.
- **Middleware**: a step that runs around a controller's routes, such as logging
  or rate limiting, and carries no business logic.
- **Authentication**: establishing who is making a request; its result is the
  request's principal.
- **Principal**: the authenticated identity a request acts as.
- **Authorization**: deciding whether a principal may invoke a route.
- **Authorization rule**: a pattern over a principal and a request that must
  match for the request to proceed.
- **Public route**: a route declared to need no authentication, so it has no
  principal.
