# Coleslaw specification

The normative contract for Coleslaw, as a set of focused chapters. Each chapter
states what the system guarantees; requirements in
[`../requirements/`](../requirements/README.md) refine chapters into testable
statements.

## Chapters

- [Overview](./overview.spec.md): what Coleslaw is for, its principles, its
  layers and what each may call, how a process starts, its modes, and how
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
- [Expressions](./expressions.spec.md): purity, scope, core functions, identity
  and deep equality, and failure.
- [Services](./services.spec.md): declarations, queries and effects, the clock
  and identity services, and failure.
- [Managers](./managers.spec.md): operations, their state machines, the one
  command, and results.
- [Reactors](./reactors.spec.md): reactions, commands and effects, repeats,
  order, and failure.
- [Config](./config.spec.md): settings, sources and precedence, naming
  conventions, and parsing input.
- [Modes](./modes.spec.md): named modes of four kinds, the default, selecting
  one, and stopping.
- [Startup](./startup.spec.md): the pipeline, and how service implementations
  are imported and chosen.
- [Modules](./modules.spec.md): imports and exports, contexts and their
  boundary, and packages.

## Planned chapters

These are not written yet. They are listed so that new chapters fit the intended
shape.

- `controllers/`: routes, authentication, authorization, and middleware.
- `consumers`: queues, messages, and binding them to managers.
- `jobs`: job declarations and their arguments.
- `runtime`: storing aggregate state, recording and delivering events, and the
  retry bound.

### Fundamental patterns

Patterns common enough to every application that Coleslaw makes them constructs,
so the language can constrain them, as it does state machines, managers, and
services.

- `errors`: errors as modeled data, not exceptions or logs. An error is bound to
  an aggregate, stored with it, and can be queried and projected out to users. A
  candidate home for reactions that fail every time.
- `workflows`: long-running entities that are state machines the runtime
  advances, not user code, until they reach a final state. Each has a progress:
  a tree of branches and leaves as work fans out and back in, rolled up into
  completed and total counts, plus progress content the program reports. Any
  caller can learn a workflow's state.
- `queries`: every operation that returns a set is paged, and every query is
  limited. Nested sets are limited further, and how deep set queries nest is
  limited explicitly, so payload sizes and query times stay bounded. Sorting and
  filtering are declared, opt-in per operation, never available everywhere.
  Iterating a whole collection is allowed only in modes suited to it, such as a
  job, never while serving a request.
- `timers`: deadlines and commands scheduled for later, such as escalating an
  approval not decided within three days. Time comes from the clock service, so
  a checker controls it.
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
