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
  declare two API modes, a public one and an administrative one, each with its
  own controllers, so they deploy and scale separately.
- A program MAY declare more than one mode of the same kind.
- An entry point MAY appear in more than one mode.
- Exactly one mode MUST be declared the default.

## Kinds

Coleslaw defines four kinds of mode. Each runs one kind of entry point.

| Kind   | Runs                                                                 | Entry points |
| ------ | -------------------------------------------------------------------- | ------------ |
| API    | Serves requests until stopped                                        | Controllers  |
| Worker | Handles messages from queues until stopped                           | Consumers    |
| Job    | Runs the one job its input names, then exits with that job's outcome | Jobs         |
| Events | Handles events from an event source until stopped                    | Reactors     |

- A mode MUST list only entry points of its kind.
- The kinds are built in. The design of mode kinds MUST allow extensions to add
  kinds later (see the planned `extensions` chapter), so nothing about a kind
  may be special-cased where the runtime selects or runs a mode.
- Reactors that run in process are not an entry point of any mode: they run in
  whichever mode saved the events, when the config says reactors run in process
  (see the overview's [modes](./overview.spec.md#modes)).

## Selecting a mode

- The built-in setting `mode` MUST select the mode a process runs, by its name
  in kebab case (a mode named `PublicApi` is selected by `--mode public-api`, or
  `MODE=public-api` in the environment).
- A process whose input selects no mode MUST run the default mode.
- Input that names no declared mode MUST stop the process before anything is
  constructed, with a diagnostic listing the declared modes.
- A job mode MUST also be given the name of the job to run, by the built-in
  setting `job`, and that job's arguments (see the planned `jobs` chapter).

## What a mode constructs

- A mode MUST construct only what its entry points reach: the managers they use,
  the reactors that run in process, and the services those use (see
  [startup](./startup.spec.md)).
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

- **Running elsewhere.** How the modes of one program are deployed to different
  infrastructure, such as one container image with a mode per deployment.
- **The stopping bound.** How long a mode may take to finish its work when
  stopped, and whether it is a setting.
