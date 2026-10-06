# Overview

This chapter states what Coleslaw is for, the principles every other chapter
follows, the layers a program is made of and what each may call, and how
programs run. Terms are defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Purpose

Coleslaw is a language for writing business applications: the web, CRUD, and
line-of-business systems whose value lies in their domain rules rather than in
their infrastructure. A Coleslaw program declares a domain (its aggregates), the
business operations over it (its managers), and the ways the outside world
reaches it (its controllers). The Coleslaw runtime executes that program.

Coleslaw is built with Uffda: its grammar is a Uffda language, and it uses Uffda
patterns as its types and Uffda expressions as its expression language.

## Principles

- **A constrained universe.** Each layer can express only what belongs to it.
  The language, not convention, keeps business logic out of controllers and
  infrastructure out of aggregates.
- **State machines are the only logic.** A decision that depends on state or on
  input MUST be expressed as a transition or handler in a state machine. No
  other construct branches.
- **The ubiquitous language.** Declarations are named in the domain's terms, and
  Coleslaw's own keywords are the vocabulary of domain-driven design, with the
  meanings the glossary gives them.
- **Patterns are types.** Every shape (a field, a payload, a parameter) is a
  Uffda pattern, and checking a value against a shape means matching the
  pattern.
- **Expressions are pure.** Expressions compute values and have no side effects.
  The only side effects in a program are the events aggregates emit and the
  calls managers make to services.
- **One source of truth.** A Coleslaw program is the only definition of its
  domain. Compiled forms are build outputs, never edited and never treated as
  sources. Programs are text, so they version and merge like any other code.

## Layers

| Layer      | Holds                                                                | May use                           |
| ---------- | -------------------------------------------------------------------- | --------------------------------- |
| Controller | Routes, authentication, authorization, middleware                    | Managers                          |
| Manager    | Business operations and long-running processes                       | Aggregates, projections, services |
| Aggregate  | Identity, fields, commands, events, a state machine, invariants      | Patterns and expressions only     |
| Projection | A read model derived from events                                     | Patterns and expressions only     |
| Service    | A declared capability whose implementation the host program provides | Nothing in the program            |

## Dependency rules

- A controller MUST reach the domain only through managers. It MUST NOT send
  commands to aggregates, read projections, or call services directly.
- A manager MUST be a composition: it sends commands to aggregates, reads
  projections, and calls services. Any branching in a manager MUST be a state
  machine, as everywhere else.
- An aggregate MUST NOT call managers, services, or other aggregates. It refers
  to another aggregate only by that aggregate's identity.
- An aggregate's handling of a command MUST be deterministic: given the same
  state and the same command, it emits the same events. Anything
  nondeterministic, such as the current time or a new identity, MUST arrive in
  the command.
- One command changes one aggregate. Consistency across aggregates is eventual:
  a manager reacts to one aggregate's events by sending commands to others.
- A service MUST NOT call back into the program's layers.

## Execution model

- Coleslaw programs are interpreted. The runtime, built on the Uffda runtime,
  executes compiled modules directly. Code generation MAY be added later as an
  additional transformation, but running a program MUST NOT require it.
- Aggregates are event-sourced. An aggregate's events are the source of truth
  for its state: the state is what results from applying each event, in order,
  to the aggregate's initial state. Projections are derived from events and can
  always be rebuilt from them.

## Open questions

- **Branching in managers.** Whether every manager operation is a state machine,
  or only those that branch or wait, with straight-line operations written as
  plain compositions.
- **Queries.** Whether controllers may read projections directly, as many
  read-heavy applications want, or must always go through a manager.
- **Concurrency.** How the runtime detects two commands racing on the same
  aggregate (for example, by the version of its event stream).
- **Checking programs.** Because all logic lives in state machines, programs
  could be explored systematically the way P checks its machines, including
  monitors that must not remain in a hot state.
- **Code generation.** Which targets, if any, and how their templates are
  versioned and changed.
