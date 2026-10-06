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
business operations over it (its managers), the ways the outside world reaches
it (its controllers, consumers, and jobs), its configuration, and the modes it
can run in. The Coleslaw runtime executes that program in one mode per process.

Coleslaw is built with Uffda: its grammar is a Uffda language, and it uses Uffda
patterns as its types and Uffda expressions as its expression language.

## Principles

- **A constrained universe.** Each layer can express only what belongs to it.
  The language, not convention, keeps business logic out of controllers and
  infrastructure out of aggregates.
- **State machines are the only logic.** Choosing what happens (which events are
  emitted, whether a command is rejected, which state comes next) MUST be done
  by a handler in a state machine. No other construct chooses what happens.
- **Patterns may choose values.** A pattern's alternatives MAY choose a value
  anywhere: a default that depends on another setting, a fallback for a missing
  value, or which shape an input has. Choosing a value computes it and has no
  effect, so it is not logic in the sense above.
- **The ubiquitous language.** Declarations are named in the domain's terms, and
  Coleslaw's own keywords are the vocabulary of domain-driven design, with the
  meanings the glossary gives them.
- **Patterns are types.** Every shape (a field, a payload, a parameter) is a
  Uffda pattern, and checking a value against a shape means matching the
  pattern.
- **Expressions are pure.** Expressions compute values and have no side effects.
  The only side effects in a program are the events aggregates emit and the
  calls managers and reactors make to services.
- **One source of truth.** A Coleslaw program is the only definition of its
  domain. Compiled forms are build outputs, never edited and never treated as
  sources. Programs are text, so they version and merge like any other code.

## Layers

| Layer      | Holds                                                                | May use                                              |
| ---------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Config     | The settings a process runs with, parsed from its input              | Patterns and expressions only                        |
| Controller | Routes, authentication, authorization, middleware                    | Managers, projections                                |
| Consumer   | The handling of messages from a queue                                | Managers                                             |
| Job        | A named unit of work that runs once                                  | Managers                                             |
| Manager    | Business operations: bind inputs, send one aggregate a command       | One aggregate, projections, service queries          |
| Reactor    | Reactions to events, as state machines                               | Aggregates, projections, service queries and effects |
| Aggregate  | Identity, fields, commands, events, a state machine, invariants      | Patterns and expressions only                        |
| Projection | A read model derived from aggregates' stored state                   | Patterns and expressions only                        |
| Service    | A declared capability whose implementation the host program provides | Nothing in the program                               |

## Dependency rules

- Controllers, consumers, and jobs MUST change the domain only through managers.
  They MUST NOT send commands to aggregates or call services directly.
- Controllers MAY read projections directly. Consumers and jobs read through
  managers.
- A manager operation binds its input, chooses the aggregate it concerns, and
  progresses it by sending it at most one command. Any logic it needs beyond
  that MUST be expressed as a state machine that lasts for the invocation (see
  [managers](./managers.spec.md)).
- A reactor is registered for events, and its logic MUST be expressed as one or
  more state machines. Like a manager, it progresses aggregates by sending them
  commands, and it MAY read projections and call services.
- Service operations are queries or effects. Managers and reactors MAY call
  queries; only reactors MAY call effects, so the world changes only after the
  program has (see [services](./services.spec.md)).
- A reactor MUST NOT run inside the transaction of the command whose event it
  reacts to. Each command a reaction sends is its own transaction, so one
  command still changes one aggregate (see [reactors](./reactors.spec.md)).
- An aggregate MUST NOT call managers, services, or other aggregates. It refers
  to another aggregate only by that aggregate's identity.
- An aggregate's handling of a command MUST be deterministic: given the same
  state and the same command, it emits the same events. Anything
  nondeterministic, such as the current time or a new identity, MUST arrive in
  the command.
- One command changes one aggregate. Consistency across aggregates is eventual:
  a reactor reacts to one aggregate's events by sending commands to others.
- A service MUST NOT call back into the program's layers.
- Config MUST NOT depend on any other layer. Services, and through them the rest
  of the application, are constructed from config.

## Startup

Starting a process is itself a pipeline, with the program's declarations as its
stages:

1. **Input.** The runtime gathers the process's input: its command-line
   arguments, its environment variables, and, if one is named, a config file.
   When more than one supplies the same setting, the command line MUST win over
   the environment, and the environment over the config file.
2. **Config.** The input is parsed into the program's config, by matching it
   against the config declaration. Input that does not match MUST stop the
   process before anything else is constructed, with a diagnostic naming what
   did not match.
3. **Application.** From the config, the pipeline constructs the application:
   the services, then the managers composed of them, then the controllers or
   jobs that reach those managers.
4. **Run.** The application is handed to the runtime, which runs it as the
   selected mode.

- Each stage MUST depend only on the stages before it.
- Startup MUST be free of side effects other than constructing services. In
  particular, no command is handled and no request is served until the run
  stage.

## Modes

A mode is one way a program can run, such as serving an API or running jobs.
This follows the mode pattern of a
[hybrid microservice](https://justinmchase.com/2023/03/11/hybrid-microservice-architecture/):
one program declares every mode it can run in, and each process runs exactly one
of them.

- A program MUST declare the modes it supports, and its input MUST select
  exactly one.
- Coleslaw defines four modes. Others MAY be defined later.

  | Mode   | Runs                                                                 | Entry points |
  | ------ | -------------------------------------------------------------------- | ------------ |
  | API    | Serves requests until stopped                                        | Controllers  |
  | Worker | Handles messages from queues until stopped                           | Consumers    |
  | Job    | Runs the one job its input names, then exits with that job's outcome | Jobs         |
  | Events | Handles events from an event source until stopped                    | Reactors     |

- Each mode's entry points MUST exist only in that mode: controllers only in API
  mode, consumers only in worker mode, and jobs only in job mode.
- Reactors run in one of two ways, and the config, not the program, MUST decide
  which. The same program MUST run either way without change.
  - **Distributed.** Processes that save events publish them to an event source,
    such as a Kafka topic provided by a service, and a separate process in
    events mode receives them and runs the reactors. This suits production,
    where producing and consuming scale as separate services.
  - **In process.** The process that saved the events runs the reactors itself,
    with no event source. This suits running locally, with the whole program in
    one process and its storage in memory.
- Either way, reactions follow the same rules: each runs after the event it
  reacts to is saved, events reach each reactor in order per shard key (see
  [reactors](./reactors.spec.md#order)), and the program cannot tell which way
  it is running.
- Events are delivered to reactors at least once. The runtime MUST NOT promise
  more, whichever way reactors run and whatever an event source offers, and a
  reactor MUST give the same result when it receives an event it has already
  handled. An event is identified by its aggregate's kind and identity and its
  version, so a repeat can always be recognized.
- A job's schedule is not part of the program. Whatever starts the process, such
  as cron or a deployment's migration step, decides when a job runs.
- The runtime MUST construct only what the selected mode reaches: its entry
  points, the managers they use, and the services those managers use. A service
  no entry point of the mode reaches MUST NOT be constructed, so a process never
  needs the configuration of, or a connection to, a service it does not use.
- Every mode runs the same program. Processes running different modes of one
  program MAY therefore share the program's storage, such as aggregates' stored
  state, directly: they cannot disagree about its shape.

## Services from implementors

Coleslaw does not choose an application's technologies. A program declares each
service it needs as a set of operations whose inputs and outputs are patterns;
the implementor provides an implementation of that declaration for whatever
technology they use, such as a particular database, identity provider, or
message broker.

- A program MUST be able to declare a service without naming any technology.
- An implementor MUST be able to provide their own implementation of any
  declared service, configured from the program's config.
- Values crossing a service boundary MUST match the patterns the declaration
  gives, in both directions.
- The [services](./services.spec.md) chapter defines declarations, queries and
  effects, and the clock and identity services Coleslaw provides.

## Reference applications

These existing applications show the kinds of things Coleslaw programs must be
able to express. They are examples of the patterns, not dependencies: Coleslaw
does not use them, and it may use different technologies.

- [Grove](https://github.com/justinmchase/grove), a library implementing the
  hybrid microservice mode pattern in TypeScript. It shows modes selected from
  the command line, an application context built from services, then
  repositories, then managers, and a job mode that runs one named job.
- [Deploy Approval API](https://github.com/justinmchase/deploy-approval-api), an
  application built with Grove that adds approval steps to GitHub deployments.
  Coleslaw MUST be able to express what it does, including:
  - **Config** read from the environment: required secrets (a GitHub App private
    key, a database connection string), and optional settings with defaults (the
    app id, the webhook path, the identity tenant and client).
  - **Services** for technologies the implementor chooses: a GitHub App client
    per installation, document storage, and a sign-in provider.
  - **A middleware pipeline in order**: error handling, health checks, request
    logging, static site and domain-verification files, the webhook, sign-in
    that establishes the request's user, the authenticated routes, and a final
    not-found response.
  - **Webhooks** from another system, verified by signature, whose events start
    business processes: a deployment awaiting protection rules starts an
    approval.
  - **Configuration read from the outside world** and checked against a shape:
    each repository's approval file names the approval groups each environment
    requires.
  - **An approval process that is a state machine**: a deployment needs every
    required group to approve; any rejection rejects it; with no groups
    configured it is approved automatically; an approver may change their vote
    only until the deployment is decided; and the final decision is reported
    back to GitHub. Today this logic lives in a controller, which Coleslaw's
    layers would not allow.
  - **Routes with parameters checked against shapes**: an approval state that
    must be `approved` or `rejected`, and paging with bounded `offset` and
    `limit` and defaults.
  - **Reads for the signed-in user**, such as the approvals awaiting them.

## Execution model

- Coleslaw programs are interpreted: the runtime, built on the Uffda runtime,
  interprets compiled syntax trees. Coleslaw does not generate code.
- Aggregates are stored as state, not as event histories. An aggregate's stored
  state, with its version, is the source of truth for it. Every change to that
  state is described by an event, which is delivered to what observes it.
  Nothing is restored by replaying events; a program that wants to keep them,
  for auditing or backups, does so with a reactor. Projections are derived from
  stored states and can always be rebuilt from them.

## Compilation

Coleslaw follows the same strategy as Uffda, and reuses Uffda's modules for it
wherever it can.

- Coleslaw source files MUST use the extension `.clsw`. (The earlier `.cls` is
  already claimed by LaTeX classes, VBA class modules, and Apex classes.)
- Coleslaw's grammar MUST be a Uffda language, declaring the `.clsw` extension,
  so Uffda's tools can find and parse Coleslaw source.
- Compiling a program MUST parse each source file with that grammar and write
  its syntax tree as JSON to the project's output directory (`./bin` by
  default), at the path Uffda's artifact layout gives it.
- An import of one Coleslaw file from another MUST resolve, through Uffda's
  module resolution, to the imported file's compiled syntax tree. Source is
  never parsed when a program runs.
- The runtime MUST run only compiled syntax trees, interpreting them according
  to the selected mode.
- Compiled syntax trees are build outputs: never edited, never committed, and
  always reproducible from the source.

## Checkability

Coleslaw programs are meant to be checked systematically, the way the P language
checks its machines: by running a program many times while varying everything
outside its control, and checking its monitors after each run. Such a check
finds failures that occur only in particular orderings, such as two reactions
racing or a repeated event, which neither parsing nor matching can find. The
checker itself will come later; the language MUST stay checkable now.

- Every source of variation MUST be explicit at the program's edges: the
  commands that arrive and their order, what services return, and how events are
  delivered to reactors, including repeats.
- Everything else MUST be deterministic, so that a run is reproduced exactly by
  replaying the same choices at those edges.
- A feature that would hide a source of variation inside the program, such as
  reading the clock or generating an identity other than through a service, MUST
  NOT be added. The time and new identities come from services Coleslaw
  provides, which a checker can replace.

## Uffda prerequisites

Uffda does not yet do everything this chapter assumes. These changes belong in
Uffda, specified there, before the Coleslaw chapters that depend on them:

- **Publishing its languages.** Uffda MUST publish its pattern and expression
  grammars, and what lowers them to runtime patterns and expressions, so that
  Coleslaw's grammar can import them.
- **Compiling other languages.** Uffda's compile emits only Uffda module
  declarations today. It MUST be able to compile a source file of a project
  language with that language's grammar, and write that language's syntax tree.
- **Resolving other languages.** Uffda's module resolution rejects file
  extensions other than its own today. It MUST be able to resolve an import of a
  project language's source file to that file's compiled syntax tree.
- **Matching undeclared keys.** Uffda's object pattern ignores keys it does not
  declare. It MUST be able to say what those keys must match, including that
  there may be none, so that shapes can be closed (see
  [patterns as types](./patterns-as-types.spec.md#closed-objects)).
