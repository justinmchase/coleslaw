# Modes

This chapter defines modes: declaring them, the kinds of mode, selecting one,
and what each runs. The overview's [modes](./overview.spec.md#modes) section
states the principle; this chapter makes it precise. Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaring modes

A mode is one way the program can run, and the entry to the program for the
process that runs it. Each process runs exactly one mode.

- A program MUST declare one or more modes.
- A mode declaration MUST have a kind and a name, unique among the program's
  modes, and MUST list the entry points it runs. For example, a program may
  declare two Web modes, a public one and an administrative one, each with its
  own controllers, so they deploy and scale separately.
- A program MAY declare more than one mode of the same kind.
- A domain mode MUST be declared inside its owning context. A running mode MUST
  be bound to an instance of that context; `this` in the mode's composition and
  entry-point selection MUST refer to that instance, not a static context
  declaration or Uffda parser match.
- Mode references select declarations; they MUST NOT provide static access to
  a context's job, controller, or other component bindings. Binding the owning
  context MUST NOT eagerly construct all its members.
- A mode MAY compose its owning context's entry points through `this` without
  exporting those entry points for outside access. Entry points themselves MUST
  retain their explicit dependency boundaries; mode ownership MUST NOT grant
  jobs or controllers ambient context access.
- An entry point MAY appear in more than one mode.
- Without a program selection mapping, exactly one mode MUST be declared the
  default. A program selection mapping MUST instead obtain any default label
  from the selector setting's pattern, under
  [application shell](./application-shell.spec.md#settings-and-selection);
  it MUST NOT also select a competing mode-declaration default.

## Kinds

Coleslaw defines four kinds of mode. Each runs one kind of entry point.

| Kind   | Runs                                                                 | Entry points |
| ------ | -------------------------------------------------------------------- | ------------ |
| Web    | Serves requests until stopped                                        | Controllers  |
| Worker | Handles messages from queues until stopped                           | Consumers    |
| Job    | Runs the one job its input names, then exits with that job's outcome | Jobs         |
| Events | Handles events from an event source until stopped                    | Reactors     |

- A mode MUST list only entry points of its kind.
- The job kind is named for what it runs, not why it runs. A job may be a
  migration, a one-time task, or recurring work, but when it runs is decided by
  whatever starts the process, such as cron or a deployment step. Coleslaw MUST
  NOT schedule jobs: a job mode has no schedule, and a job's declaration MUST
  NOT carry one.
- The kinds are built in. The design of mode kinds MUST allow extensions to add
  kinds later (see the planned `extensions` chapter), so nothing about a kind
  may be special-cased where the runtime selects or runs a mode.
- Internal-event reactors that run in process are not an entry point of any
  mode: they run in whichever mode saved the events, when the config says
  internal-event reactors run in process (see the overview's
  [modes](./overview.spec.md#modes)).

## Collection traversal

- Web mode MUST NOT support full collection traversal. Worker, Job, and Events
  modes MUST support it under the per-read limits of
  [queries](./queries.spec.md#mode-capability).
- This capability MUST be part of the mode kind's design, not config or an
  endpoint setting. An extension-defined kind MUST declare its capability.
- Managers and in-process reactors MUST inherit the running mode's capability.
  A reactor that needs full traversal MUST NOT run in process in Web mode; it
  must run in a supporting mode such as Events.

## Selecting a mode

- Without a program selection mapping, the built-in setting `mode` MUST select
  the mode a process runs, by its name
  in kebab case (a mode named `PublicApi` is selected by `--mode public-api`, or
  `MODE=public-api` in the environment).
- A process whose input selects no mode MUST run the default mode when one
  exists. A mapping with no selector value or pattern default MUST fail startup.
- A program MAY map short setting values to declared modes and shaped mode
  arguments. Such a mapping MUST select exactly one mode and MUST fail on an
  unmatched value (see
  [application shell](./application-shell.spec.md#settings-and-selection)).
- Input that names no declared mode MUST stop the process before anything is
  constructed, with a diagnostic listing the declared modes.
- A job mode MUST also select exactly one job, either by the built-in setting
  `job` or an explicit `jobs(selector)` mapping, and resolve that job's arguments
  (see
  [jobs](./jobs.spec.md#selecting-a-job)).

## What a mode constructs

- A mode MUST construct only what its selected entry points reach: the managers
  they use,
  the reactors that run in process, the queues they send to or consume, the
  external event sources they handle, and the services those use (see
  [startup](./startup.spec.md)).
- A Job mode's explicit mapping MUST select exactly one matching branch before
  reachability and construction. Unselected jobs MUST NOT cause dependencies
  to be constructed or their settings to be required.
- The config MUST be checked only for the settings the selected mode reaches. A
  process MUST NOT need settings, such as a connection string, for a service its
  mode never uses.

## Stopping

- A mode that runs until stopped MUST stop when its process is asked to, such as
  by a termination signal: it stops taking new requests, messages, or events,
  finishes or abandons what it has started within a bounded time, and exits.
- Abandoning work MUST be safe: a request abandoned before its command is saved
  changed nothing, and a message or event not completed is delivered again.
- A job mode exits when its job ends. Its exit status MUST say whether the job
  completed, and otherwise how it ended.

## Open questions

- **Context-owned mode selection.** The exact program-reference and import
  syntax for exported nested modes, and resolving modes with colliding names
  in different contexts. References MUST preserve ownership and instance
  binding; ambiguous references MUST NOT be guessed.
- **Running elsewhere.** How the modes of one program are deployed to different
  infrastructure, such as one container image with a mode per deployment.
- **The stopping bound.** How long a mode may take to finish its work when
  stopped, and whether it is a setting.
