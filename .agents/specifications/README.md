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

## Planned chapters

These are not written yet. They are listed so that new chapters fit the intended
shape.

- `modules`: files, bounded contexts, and imports.
- `patterns-as-types`: fields, payloads, and value objects as Uffda patterns.
- `expressions`: the embedded Uffda expression language.
- `config`: the config declaration, input sources and their precedence, and
  parsing input into config.
- `startup`: the pipeline from config to an application.
- `modes`: declaring modes, selecting one, and what each mode constructs and
  runs.
- `managers` and `services`: binding inputs to aggregates, and the
  host-implemented edge.
- `reactors`: reacting to events, in process and in events mode.
- `controllers/`: routes, authentication, authorization, and middleware.
- `consumers`: queues, messages, and binding them to managers.
- `jobs`: job declarations and their arguments.
- `runtime`: storing aggregate state, recording and delivering events, and the
  retry bound.
