# Jobs

This chapter defines jobs: the entry point by which a process runs one named
unit of work and exits. It covers declaring a job and its arguments, selecting
the job a job mode runs, how its arguments are named in each config source, the
state machine a job runs, how a job ends, and running a job again after it ends
partway. The [modes](./modes.spec.md) chapter defines job modes; this chapter
defines what they run. Terms are defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaring a job

A job is a named unit of work that runs once, in a job mode, such as a
migration, a one-time correction, or recurring work like closing yesterday's
orders. Like every entry point, it reaches the domain only through managers.

- A job declaration MUST name the job, MAY declare its [arguments](#arguments),
  and MUST declare the state machine it runs (see
  [the job's state machine](#the-jobs-state-machine)).
- A job is owned: it MUST be a member of at most one context (see
  [declaring a context](./modules.spec.md#declaring-a-context)). It MAY invoke
  the managers of its own context only, since contexts never export managers,
  and MAY use shapes and funcs freely.
- A mode MUST reach a job through its context, which MUST export it, such as
  `Catalog.MigratePrices` (see [the boundary](./modules.spec.md#the-boundary)).
- A job MUST NOT send commands to aggregates, read projections, or call
  services. A job that does any of these MUST be a compile error. What it needs
  to read, and the current time or a new identity, it gets from a manager
  operation.
- Job mode permits full collection traversal through those manager operations,
  with every page still bounded by [queries](./queries.spec.md#mode-capability).
  The permission belongs to the mode, not to a job declaration.
- A job declaration MUST NOT carry a schedule. When a job runs is decided by
  whatever starts the process, such as cron or a deployment's migration step
  (see [kinds](./modes.spec.md#kinds)).

## Arguments

A job's arguments are the input it starts with. They come from the same input as
the rest of the config, and are parsed the same way.

- A job's arguments MUST be declared as the config declaration declares
  settings: a tree of named arguments, each with a shape (see
  [the config declaration](./config.spec.md#the-config-declaration)).
- An argument MAY give a default, or be optional, through its shape. An argument
  with neither is required.
- An argument MAY be marked secret, and is then treated as a secret setting is.
- An argument's shape MUST accept only data (see
  [data](./patterns-as-types.spec.md#data)).
- Values arrive as strings, and an argument's shape MUST parse them, as a
  setting's shape does (see
  [parsing input into config](./config.spec.md#parsing-input-into-config)). For
  example, an argument `since` whose shape matches a string such as `2026-01-01`
  and projects a date gives the job a date.
- The arguments of the job a process runs are settings of its config, and are
  checked when the rest of its config is. The arguments of every other job are
  not part of its config.

## Selecting a job

- The built-in setting `job` MUST select the job a job mode runs, by its name in
  kebab case, from the jobs that mode lists. A job named `MigratePrices` is
  selected by `--job migrate-prices`, or `JOB=migrate-prices` in the
  environment.
- A job mode that lists exactly one job MUST run it when the input selects no
  job. A job mode that lists more than one MUST stop the process before anything
  is constructed when the input selects none, with a diagnostic listing the
  mode's jobs.
- Input that names no job the selected mode lists MUST stop the process before
  anything is constructed, with a diagnostic listing the mode's jobs.
- The job MUST be selected with the mode, before startup finds what the mode
  reaches (see [the pipeline](./startup.spec.md#the-pipeline)). A job mode
  reaches only the selected job, so it constructs only the managers that job
  invokes and the services those use, and checks only that job's arguments.
- The `job` setting and every job's arguments are settings only of job modes.
  Supplying either on the command line to a mode of another kind MUST stop the
  process as an unknown flag does.
- A job's name MUST identify one job among all the jobs the program's modes
  list. Two different jobs with the same name, even in different contexts and
  listed by different modes, MUST be a compile error naming both, so a job's
  name and its arguments' names mean one thing wherever they are supplied.

## Names of arguments

A job's arguments are named under a segment for the job, as an implementation's
settings are named under its service's (see
[services](./startup.spec.md#services)). So an argument supplied for one job is
never read by another.

- An argument's path MUST be the job's name in camel case as its first segment,
  followed by the argument's path in the job's arguments. The argument
  `batchSize` of the job `MigratePrices` has the path `migratePrices.batchSize`.
- An argument's names in each source then follow the config chapter's
  conventions (see
  [names in each source](./config.spec.md#names-in-each-source)):
  `migratePrices.batchSize` is the flag `--migrate-prices.batch-size` and the
  environment variable `MIGRATE_PRICES__BATCH_SIZE`.
- So a process might be started with
  `--mode jobs --job migrate-prices --migrate-prices.since 2026-01-01`, or with
  `MODE=jobs JOB=migrate-prices MIGRATE_PRICES__SINCE=2026-01-01` in the
  environment.
- An argument MAY declare a different name for any source, as a setting may.
- An argument's names MUST NOT collide with any other setting's, including the
  built-in settings and services' settings. A collision MUST be a compile error,
  as the config chapter requires.

## The job's state machine

A job runs a state machine, as a manager's operation and a reaction do. It lives
for one run of the job: it is created when the job starts, and is gone when the
job ends. It is never stored.

- A job's state machine MUST have exactly one start state, which receives the
  job's arguments.
- The machine MAY declare variables, set by handlers and read by expressions,
  which last for the run.
- Each state that is not final MUST perform exactly one step when the machine
  enters it:
  - invoke an operation of a manager (see [managers](./managers.spec.md));
  - or none, to choose the next state from the variables alone.
- A step's arguments MUST be computed by expressions from the job's arguments
  and the variables.
- A step's result is the operation's result: completed with its value, refused,
  rejected with the reason, conflicted, or failed with an error (see
  [results](./managers.spec.md#results)).
- A state MUST declare handlers for its step's result: each guarded by a pattern
  the result must match, tried in order, which MAY set variables and MUST choose
  the next state.
- Given the same arguments and the same step results, a job's state machine MUST
  take the same path and end the same way. Its only variation is what its steps
  return.

## Sequencing operations

A job does its work as a sequence of operations, each a separate invocation of a
manager. A migration, for example, starts in a state that invokes an operation
returning a page of the items not yet migrated, moves to a state that invokes an
operation migrating the next item on that page, returns to it for each item, and
then asks for the next page, until a page comes back empty.

- A job MAY invoke any number of operations, of any of its context's managers,
  in the order its machine performs them, including the same operation many
  times.
- Each operation a job invokes MUST be handled as its own invocation, sending at
  most one command, which is its own transaction (see
  [the command](./managers.spec.md#the-command)). A job never makes two
  operations, or two aggregates, one unit of consistency.
- A job MUST NOT invoke an operation before the one it invoked last has given
  its result.
- A job reads only what its operations return. A job that pages through a
  projection does so through an operation that reads one page of it and returns
  the page and where the next begins.

## How a job ends

A job ends in exactly one of these, and its job mode exits with a status that
says which:

- **Completed**: the machine reached a final state that completes the job.
- **Refused**: the job's arguments did not match their shapes, so it never
  started, or a step was refused and no handler matched it.
- **Rejected**, with the reason: a step was rejected and no handler matched it,
  or the machine reached a final state that ends the job as rejected, with a
  reason computed by expressions from the arguments and the variables. For
  example, a job that handles each rejected item and carries on MAY end as
  rejected when any item was.
- **Conflicted**: a step conflicted and no handler matched it.
- **Failed**, with an error: a step failed and no handler matched it, a
  completed step's value matched no handler, or an expression failed. An error
  of the job's own MUST name the job, the state, and the result.
- **Stopped**: the process was asked to stop before the job ended (see
  [stopping](#stopping)).

- A final state MUST either complete the job or end it as rejected. A job gives
  no result value.
- A job's arguments that do not match their shapes MUST stop the process before
  anything is constructed, with the config chapter's diagnostic, and end the job
  as refused.
- The job mode MUST exit with status zero when the job completed, and otherwise
  with a non-zero status that identifies how it ended. Each way a job can end
  MUST have its own status, the same in every program.
- A process that stops before its job starts, for any reason other than its
  arguments, such as a setting that fails its shape or a service that cannot be
  constructed, MUST exit with a status distinct from every way a job can end.
- When a job ends other than completed, it MUST report how it ended, naming the
  job, the state it was in, and the step's result, but never a secret's value.

## Ending partway and running again

A job is not a transaction. When it ends partway, the operations it already
invoked have had their effect, and Coleslaw does not undo or resume them.

- When a job ends other than completed, the changes made by the operations it
  invoked before then MUST stand. Its report MUST say that earlier operations
  may have changed the domain.
- The runtime MUST NOT retry a job, or any step of one. Running a job again is
  the decision of whatever starts the process.
- A job MUST be safe to run again with the same arguments, whether its earlier
  run completed or ended partway: running it again MUST NOT repeat a change an
  earlier run made.
- A job MUST NOT store its own progress. It finds what remains by asking, such
  as through an operation that pages only the items not yet migrated, so a run
  after a partial one picks up where it left off. Anything a job must remember
  between runs is an aggregate it progresses through managers.
- Commands are safe to repeat when the aggregate's state machine ignores or
  rejects a command whose change has already happened (see
  [invoked more than once](./managers.spec.md#invoked-more-than-once)). A job
  SHOULD invoke operations whose commands are handled this way, and SHOULD
  handle such a rejection as an expected result rather than end on it.

## Stopping

- A job mode asked to stop, such as by a termination signal, MUST NOT start
  another step. It MUST let the step it is performing give its result, or
  abandon it, within a bounded time, and exit as stopped.
- Abandoning a step MUST be safe: an operation abandoned before its command is
  saved changed nothing, and one whose command was saved stands. A job written
  to be run again is therefore safe to stop at any point.

## Open questions

- **Bounding a job.** A job's machine may loop, for example paging through a
  projection, and a migration may legitimately run for hours. Whether a job's
  steps or its running time are bounded, and how.
- **Overlapping runs.** Coleslaw does not prevent two processes from running the
  same job at once, such as when one cron run outlasts its interval. Whether it
  should offer a way to hold a job exclusively, and whether a job safe to run
  again must also be safe to run concurrently.
- **Exit statuses.** Which number each way a job can end exits with, and whether
  they follow a convention such as `sysexits.h`.
- **Reporting.** Whether a job may report what it did, such as how many items it
  migrated, and where that report goes, given that a job gives no result value
  and calls no services.
- **Jobs with the same name.** Whether a mode MAY give a job a different name
  where it lists it, so that two contexts' jobs with the same name can both be
  run, rather than being a compile error.
- **Arguments from config.** Whether a job's arguments MAY default to a value of
  the program's other settings, or are always independent of them.
