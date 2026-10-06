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

## Planned chapters

These are not written yet. They are listed so that new chapters fit the intended
shape.

- `modules`: files, bounded contexts, and imports.
- `config`: the config declaration, input sources and their precedence, and
  parsing input into config.
- `startup`: the pipeline from config to an application.
- `modes`: declaring modes, selecting one, and what each mode constructs and
  runs.
- `reactors`: reacting to events, in process and in events mode.
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
