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
| Config     | The settings a process runs with, parsed from its input              | Patterns and expressions only     |
| Controller | Routes, authentication, authorization, middleware                    | Managers                          |
| Consumer   | The handling of messages from a queue                                | Managers                          |
| Job        | A named unit of work that runs once                                  | Managers                          |
| Manager    | Business operations and long-running processes                       | Aggregates, projections, services |
| Aggregate  | Identity, fields, commands, events, a state machine, invariants      | Patterns and expressions only     |
| Projection | A read model derived from events                                     | Patterns and expressions only     |
| Service    | A declared capability whose implementation the host program provides | Nothing in the program            |

## Dependency rules

- Controllers, consumers, and jobs MUST reach the domain only through managers.
  They MUST NOT send commands to aggregates, read projections, or call services
  directly.
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
- Coleslaw defines three modes. Others MAY be defined later.

  | Mode   | Runs                                                                 | Entry points |
  | ------ | -------------------------------------------------------------------- | ------------ |
  | API    | Serves requests until stopped                                        | Controllers  |
  | Worker | Handles messages from queues until stopped                           | Consumers    |
  | Job    | Runs the one job its input names, then exits with that job's outcome | Jobs         |

- Each mode's entry points MUST exist only in that mode: controllers only in API
  mode, consumers only in worker mode, and jobs only in job mode.
- A job's schedule is not part of the program. Whatever starts the process, such
  as cron or a deployment's migration step, decides when a job runs.
- The runtime MUST construct only what the selected mode reaches: its entry
  points, the managers they use, and the services those managers use. A service
  no entry point of the mode reaches MUST NOT be constructed, so a process never
  needs the configuration of, or a connection to, a service it does not use.
- Every mode runs the same program. Processes running different modes of one
  program MAY therefore share the program's storage, such as its event streams,
  directly: they cannot disagree about its shape.

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

## Reference applications

These existing applications show the kinds of things Coleslaw programs must be
able to express. They are examples of the patterns, not dependencies: Coleslaw
does not use them, and it may use different technologies.

- [Grove](https://github.com/justinmchase/grove), a library implementing the
  hybrid microservice mode pattern in TypeScript. It shows modes selected from
  the command line, an application context built from services, then
  repositories, then managers, and a job mode that runs one named job.
- [Real Polite Protocol](https://github.com/justinmchase/real-polite-protocol),
  an application built with Grove. Coleslaw MUST be able to express what it
  does, including:
  - **Config** read from the environment, with defaults, values derived from
    other settings (such as a public domain computed from a hostname and port),
    and defaults that depend on other settings or on where the process runs.
  - **Middleware**: CORS, including unauthenticated preflight requests, and
    bearer-token authentication that establishes the request's principal or
    answers with an authentication challenge.
  - **Controllers** that check requests before anything else happens: content
    type and size limits, signature verification, freshness windows, and
    rejecting duplicates, each failure answered with its own status and error
    code.
  - **Requests dispatched by shape**: different kinds of envelope, told apart by
    their contents, routed to different handling.
  - **Discovery endpoints**, such as OAuth protected-resource metadata.
  - **Managers** per domain area (accounts, contacts, invitations, messages,
    policies), composed of storage, authentication, and event services.
  - **Migrations**, run before the application serves requests.
  - **Domain errors** that map to responses.
  - **Tools exposed over MCP** alongside the HTTP routes.

## Execution model

- Coleslaw programs are interpreted. The runtime, built on the Uffda runtime,
  executes compiled modules directly. Code generation MAY be added later as an
  additional transformation, but running a program MUST NOT require it.
- Aggregates are event-sourced. An aggregate's events are the source of truth
  for its state: the state is what results from applying each event, in order,
  to the aggregate's initial state. Projections are derived from events and can
  always be rebuilt from them.

## Open questions

- **Choices that are not logic.** Patterns choose between alternatives, and
  config needs choices such as "port 8000 on localhost, otherwise 443". Whether
  such choices are written as pattern alternatives with projections, and how
  that squares with state machines being the only logic, needs a precise rule:
  for example, that patterns may classify values but only state machines may
  decide behavior.
- **MCP.** Whether tools exposed over MCP are another kind of entry point, or
  routes of a kind within API mode.
- **Migrations.** Whether migrations are jobs run by the deployment, as job mode
  suggests, or a step of startup in every mode, as Real Polite Protocol does
  today. With event-sourced aggregates they may matter mostly for projections.

- **Reacting to events.** Managers that react to one aggregate's events, to keep
  others eventually consistent, must run somewhere. Worker mode is the natural
  home, with events delivered to consumers through a queue; whether they may
  also run in the process that emitted the events is undecided.
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
