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
- **Context**: a bounded context. A named boundary within which every term in
  the program's domain has a single meaning. The same word MAY mean different
  things in different contexts, and contexts integrate by translating between
  their models.

## Shapes and values

- **Pattern**: a Uffda pattern. Coleslaw uses patterns as its types: a value has
  a shape when it matches the pattern.
- **Value object**: a named pattern for a domain value with no identity of its
  own, such as an email address, an amount of money, or a date range. Two value
  objects are equal when their values are equal. Value objects are immutable.
- **Expression**: a Uffda expression. Expressions compute values and have no
  side effects.

## Domain

- **Aggregate**: a cluster of domain data treated as a single unit for changes.
  It is the consistency boundary: its invariants hold after every command, and
  one command changes one aggregate.
- **Identity**: the value that distinguishes one aggregate from every other of
  its kind, constant for the aggregate's life.
- **Field**: a named piece of an aggregate's state, with a pattern its value
  must match.
- **Invariant**: a business rule about an aggregate's state that must hold after
  every command.
- **Relationship**: a reference from one aggregate to another, made by identity.
  A relationship never makes two aggregates one unit of consistency.
- **Command**: a request to change one aggregate, named in the imperative (for
  example `Publish`). It carries a payload, and it may be rejected.
- **Event**: a fact about a change that happened, named in the past tense (for
  example `Published`). It carries a payload. Events are immutable and are the
  source of truth for an aggregate's state.
- **Stream**: the ordered events of one aggregate.
- **Version**: the number of events in a stream. Each event's version is its
  position in the stream.
- **Event record**: an appended event together with what the runtime records
  with it: the aggregate's kind and identity, the event's version, and the time
  it was recorded.
- **Replay**: evolving an aggregate's initial state by each event in its stream,
  in order. An aggregate's state is its replay.
- **Entity**: a value inside an aggregate with an identity unique only within
  that aggregate, such as a line of an order.
- **Outcome**: how handling a command ends: accepted, with the events appended;
  rejected, with a reason; or conflicted, when concurrent changes outlasted the
  runtime's retries.
- **Rejection**: a decision to refuse a command, with a reason. A rejection is a
  normal business outcome, not an error.
- **Conflict**: an append that failed because the stream's version changed after
  the decision was made.
- **Projection**: a read model built by applying events, from one or more
  streams, to an initial value. A projection can always be rebuilt from the
  events.

## State machines

- **State machine**: a set of states, one of them the start state, with handlers
  for the commands and events each state accepts. State machines are the only
  place a Coleslaw program branches.
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
  environment variables, and, if one is named, a config file.
- **Config**: the settings a process runs with, parsed from its input by
  matching it against the program's config declaration.
- **Mode**: one way a program can run. A program declares its modes, and each
  process runs exactly one.
- **API mode**: the mode that serves requests through controllers until stopped.
- **Worker mode**: the mode that handles messages from queues through consumers
  until stopped.
- **Job mode**: the mode that runs the one job its input names, then exits with
  that job's outcome.
- **Application**: what startup constructs from the config for one mode: the
  services, managers, and entry points that mode reaches. The program is the
  source; an application is one running instance of it.
- **Entry point**: how the outside world invokes managers: a controller's routes
  in API mode, consumers in worker mode, or jobs in job mode.

## Layers

- **Manager**: a business operation, or a long-running business process, that
  composes aggregates, projections, and services.
- **Service**: a capability the program declares and the host program
  implements, such as sending email or charging a card. Services are the edge of
  the program.
- **Controller**: a set of routes by which the outside world invokes managers.
- **Queue**: a durable, ordered source of messages, such as a message broker's
  queue or topic subscription, provided by a service.
- **Message**: one item taken from a queue. Its body is matched against a
  pattern, like any other input.
- **Consumer**: a binding from a queue's messages to a manager, in worker mode.
- **Job**: a named unit of work that invokes managers and runs once, in job
  mode. Whatever starts the process, such as cron or a migration step, decides
  when it runs. Its arguments are matched against a pattern, like any other
  input.
- **Route**: a binding from an external request, such as an HTTP method and
  path, to a manager.
- **Middleware**: a step that runs around a controller's routes, such as logging
  or rate limiting, and carries no business logic.
- **Authentication**: establishing who is making a request; its result is the
  request's principal.
- **Principal**: the authenticated identity a request acts as.
- **Authorization**: deciding whether a principal may invoke a route.
