# Coleslaw specification

The normative contract for Coleslaw, as a set of focused chapters. Each chapter
states what the system guarantees; requirements in
[`../requirements/`](../requirements/README.md) refine chapters into testable
statements.

## Chapters

- [Application shell](./application-shell.spec.md): initial grammar, CLI,
  settings-based selection, explicit composition, and typed host adapters.

- [Overview](./overview.spec.md): what Coleslaw is for, its principles, its
  layers and what each may cause, how a process starts, its modes, and how
  programs run.
- [Glossary](./glossary.spec.md): the vocabulary every other chapter, and the
  language's keywords, use.
- [Aggregates](./aggregates.spec.md): what an aggregate is, handling a command,
  outcomes, and optimistic concurrency.
  - [Fields](./aggregates/fields.spec.md): state and invariants.
  - [Commands and events](./aggregates/commands-and-events.spec.md):
    declarations, payloads, and event records.
  - [State machines](./aggregates/state-machines.spec.md): states, deciding, and
    evolving.
  - [Relationships](./aggregates/relationships.spec.md): references by identity,
    and entities within an aggregate.
  - [Projections](./aggregates/projections.spec.md): read models derived from
    aggregates' stored state.
  - [Monitors](./aggregates/monitors.spec.md): observers that assert rules about
    events.
- [Patterns as types](./patterns-as-types.spec.md): shapes, closed objects, the
  values a program may store, equality, and value objects.
- [Types](./types.spec.md): required persisted-field value contracts,
  construction, canonicalization, inspectable storage metadata, field
  nullability, and nominal aggregate identities with explicit allocation.
- [Expressions](./expressions.spec.md): purity, scope, Uffda expression globals,
  identity and deep equality, and failure.
- [Services](./services.spec.md): declarations, queries and effects, and
  failure. Time, identities, and seeded randomness are Kith edges.
- [Managers](./managers.spec.md): operations, their state machines, the one
  command, and results.
- [Reactors](./reactors.spec.md): reactions to internal and external events,
  their capabilities, repeats, order, and failure.
- [Config](./config.spec.md): settings, sources and precedence, naming
  conventions, and parsing input.
- [Modes](./modes.spec.md): named modes of four kinds, the default, selecting
  one, and stopping.
- [Startup](./startup.spec.md): the pipeline, and how service implementations
  are imported and chosen.
- [Modules](./modules.spec.md): imports and exports, contexts and their
  boundary, and packages.
- [Controllers](./controllers.spec.md): routes, binding requests, responses,
  authentication, authorization, middleware, and the server.
- [Queues](./queues.spec.md): program-owned work messages, the outbox, delivery
  to consumers, dispositions, dead letters, and order groups.
- [Consumers](./consumers.spec.md): binding queue messages to managers and the
  state machine a handling runs.
- [Jobs](./jobs.spec.md): declarations, arguments and their names, selecting a
  job, the job's state machine, how a job ends, and running again.
- [Runtime](./runtime.spec.md): storing aggregate state, handling commands, the
  retry bound, and recording and delivering events and outbox messages.
- [Errors](./errors.spec.md): aggregate-owned error kinds and identified
  occurrences, explicit raising and resolution, retained state, and projections.
- [Queries](./queries.spec.md): bounded reads, global and endpoint limits,
  offset pages, nested results, declared filtering and sorting, cursor
  iteration, and traversal capabilities of modes.

## Not chapters

- A long-running business process is an aggregate state machine. Coleslaw does
  not specify a workflows chapter. Kith removed workflows, and Coleslaw does
  not restore that runtime, a flow graph, or a `run` primitive.
- A deadline is Kith's `Timer`, or one `send after` on the dispatcher clock.
  `Timer(interval: Milliseconds)` takes a positive number of milliseconds, such
  as `Timer(interval: 1500)`. It arms a delay, sends `@Tick` up, and rearms the
  same interval. `send after` is a one-shot delay in seconds. Recurrence that
  is not `Timer` is the handler sending again. Coleslaw may name a deadline in
  domain words. It does not specify a timers chapter or a second scheduling
  mechanism. There is no `every`, `sleep`, or `setTimeout`.

## Planned chapters

These are not written yet. They are listed so that new chapters fit the intended
shape.

### Fundamental patterns

Patterns common enough to every application that Coleslaw makes them constructs,
so the language can constrain them, as it does state machines, managers, and
services.

- `tenancy`: every aggregate, projection, and query scoped to a tenant, enforced
  by the language rather than by remembering a filter.
- `problems`: one standard response format, such as RFC 9457 problem details,
  for refused input, rejections, conflicts, and failures, so every client reads
  them the same way.
- `deletion`: two fundamental states every aggregate's state machine has,
  `Discarded` and `Removed`, entered only through handlers the aggregate
  declares, so an aggregate that must never be deleted declares none.
  `Discarded` is soft deletion: the stored state stays, projections and queries
  hide it by default, other commands are rejected, and it MAY be restored.
  `Removed` is hard deletion, reachable only from `Discarded`: it is final, and
  the runtime erases the aggregate's fields, keeping a tombstone of its identity
  and version so the identity cannot start over at version zero. Each move is an
  ordinary command and event, so reactors see it.
- `mocking`: replacing services, and giving aggregates and projections chosen
  states, so a program's managers, reactors, and controllers can be tested
  without real technologies.

### Cross-cutting concerns

- `extensions`: concerns that run through every program regardless of its code,
  added to the runtime rather than written in the program: correlating each
  command and event with the request, job, or event that caused it, auditing who
  did what, and tracing. Extensions also add to layers that are open by design:
  config sources, such as a `.env` file, and kinds of mode.
- `decorators`: attributes on declarations, as Uffda's decorators are, such as
  `[Auditable]` on an event. A decorator attaches data to a declaration and does
  no work itself; an extension reads that data and acts on it. So a program
  chooses which declarations an extension applies to, without the extension's
  behavior entering the program.
