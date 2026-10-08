# Startup

This chapter defines how a process starts: the pipeline from input to a running
mode, and how service implementations are provided and chosen. The overview's
[startup](./overview.spec.md#startup) section states the pipeline; this chapter
makes it precise. Terms are defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## The pipeline

1. **Input.** Gather the command line, the environment, and any sources
   extensions add (see [config](./config.spec.md#sources)).
2. **Mode.** Select the mode from the input (see
   [modes](./modes.spec.md#selecting-a-mode)).
3. **Reach.** Bind the selected mode's explicit composition and find what it
   reaches: its entry points, the managers they
   use, the reactors selected to run in process or events mode, the queues
   managers and reactors enqueue to or consumers handle, the external event
   sources reactors handle, and the services all of those use.
4. **Config.** Parse the input into config, checking only the settings the mode
   reaches (see [config](./config.spec.md#parsing-input-into-config)).
5. **Application.** Construct the services the mode reaches, then the managers
   and reactors, then the entry points.
6. **Run.** Hand the application to the runtime, which runs the mode.

- Each stage MUST depend only on the stages before it.
- A failure in any stage before running MUST stop the process with a diagnostic,
  before any command is handled or any request served.
- Startup MUST have no effects other than constructing services, such as opening
  connections.
- Settings referenced by a program's selection mapping MUST be resolved before
  selecting the mode; the remaining reached config is validated afterwards
  (see [application shell](./application-shell.spec.md#settings-and-selection)).

## Services

A service has a declaration, which names no technology, and implementations,
which the implementor writes for particular technologies.

- An implementation MUST be a module, imported like any other through Uffda's
  module resolution. An implementation written in TypeScript is a module whose
  default export declares the implementation, with a host function for each of
  the service's operations.
- Host code MUST appear only in service implementations and the explicitly
  defined runtime/infrastructure adapters of the
  [application shell](./application-shell.spec.md#host-boundary), never domain
  expressions or aggregate/manager business logic.
- Domain modules, those declaring aggregates, projections, managers, and
  reactors, MUST refer only to service declarations, never to implementations,
  so the domain names no technology. Implementations MUST be imported only by
  modules declaring modes.
- A mode MAY import several implementations of one service. The config MUST
  choose which one a process uses, through a built-in setting named after the
  service; with only one imported, that one is used.
- An implementation MAY declare its own settings, such as a connection string.
  They MUST be part of the config, under the service's settings, and are checked
  only when that implementation is chosen.
- A queue's implementations MUST be provided and chosen as a service's are (see
  [queues](./queues.spec.md#implementations)).
- An external event source's implementation MUST be provided and chosen through
  config as the selected mode reaches it (see
  [external events](./reactors.spec.md#external-events)).
- Coleslaw MUST provide default implementations of the services the runtime
  itself needs, in memory where they store data, such as the state store and the
  event source (see [runtime](./runtime.spec.md)), and an HTTP server (see
  [controllers](./controllers.spec.md)), so a program runs locally with no
  technology chosen.

## Open questions

- **Construction order and failure.** Whether services are constructed in
  parallel, and whether a service that fails to construct may be retried before
  the process stops.
