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

## Planned chapters

These are not written yet. They are listed so that new chapters fit the intended
shape.

- `modules`: files, bounded contexts, and imports.
- `patterns-as-types`: fields, payloads, and value objects as Uffda patterns.
- `expressions`: the embedded Uffda expression language.
- `aggregates/`: aggregates, fields, commands, events, state machines,
  projections, relationships, and monitors.
- `config`: the config declaration, input sources and their precedence, and
  parsing input into config.
- `startup`: the pipeline from config to an application.
- `modes`: declaring modes, selecting one, and what each mode constructs and
  runs.
- `managers` and `services`: composition, and the host-implemented edge.
- `controllers/`: routes, authentication, authorization, and middleware.
- `consumers`: queues, messages, and binding them to managers.
- `jobs`: job declarations and their arguments.
- `runtime`: command transactions, event storage, ordering, and determinism.
