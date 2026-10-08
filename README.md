# Coleslaw

A constrained business-application language built with
[Uffda](https://github.com/justinmchase/uffda). Its modular `.uff` grammar
reuses Uffda's tokenizer, patterns, expressions, and import syntax. TypeScript
supplies semantic checking, explicit composition, runtime adapters, and the
`cslw` CLI; domain decisions remain declarative Coleslaw.

## Development prerequisites

Use Deno 2 and the released
[Uffda CLI](https://github.com/justinmchase/uffda/releases/latest), version
0.9.2 or later, installed on `PATH`. Coleslaw imports the public Uffda 0.9.2
APIs and grammar components from JSR. Both local development and
[CI](./.github/workflows/checks.yml) use released dependencies only; neither
loads or builds a sibling Uffda checkout.

```sh
uffda --version
deno task grammar
deno task check
deno task test
./cslw --help
```

Source files use `.clsw`; projects use [clsw.jsonc](./clsw.jsonc) and
[clsw.lock](./clsw.lock). Project imports, exports, and output directories
follow Uffda's project format. The executable is named `cslw`.

The grammar compile command above is for a fresh checkout; Uffda refuses to
overwrite existing artifacts by default. Application-module imports currently
support relative local `.clsw`, `.ts`, and `.js` files. The project import map
and lockfile are used for Uffda grammar packages; application package imports
remain unsupported and are diagnosed explicitly.

## CLI

```sh
./cslw parse examples/shell/app.clsw
./cslw check examples/shell/app.clsw
./cslw compile examples/shell/app.clsw
./cslw run examples/shell/app.clsw job example
```

`parse` prints the syntax AST. `check` resolves imports and checks declarations
and composition without invoking component factories. `compile` writes a
versioned checked artifact and prints its path; pass that path to `run` to
execute it. Stale source/dependencies and incompatible artifacts are refused.
Invalid input and runtime failures produce diagnostics and nonzero exits.
Formatting is deferred; `fmt` is not implemented.

The [shell example](./examples/shell/app.clsw) is deliberately a test adapter:
it demonstrates positional selection of exactly one job, not domain behavior.

## Settings and explicit composition

The [Types specification](./.agents/specifications/types.spec.md) defines the
next value/identity model: arbitrary field patterns, optional named Types,
storage metadata, explicit creation, field nullability, and nominal relationship
identities. It is a design contract, not implemented syntax yet. The executable
[runtime Counter example](./examples/domain/counter-runtime.clsw) still uses the
initial pattern-backed field grammar and identity initializer; it will be
migrated with requirement-citing tests in the implementation slice.

```text
import "./host.ts" ExampleJob;

export config Settings {
  mode: ("job");
  jobName: (string);
}

export mode Batch: Job {
  jobs {
    ExampleJob example;
  }
}

export program Application {
  config Settings settings;
  arguments {
    0: settings.mode;
    1: settings.jobName;
  }
  mode settings.mode {
    "job" => Batch(settings.jobName);
  }
}
```

Config supports nested settings, Uffda patterns, and `secret` settings with
redacted diagnostics. Precedence is named flags, positional bindings,
environment input, then pattern defaults. Resolve selector settings first;
credentials needed only by unselected modes are not required.

Reusable shapes and explicitly shaped mode parameters are supported:

```text
export shape JobName = (string);
export mode Batch(jobName: (JobName)): Job {
  jobs {
    ExampleJob example;
  }
}
```

Selection arguments match the ordered parameter shapes before construction.
Parameters can also be explicitly injected into component factories. Shapes use
ordinary named imports/exports, with unknown names and cycles rejected. Config
patterns stay self-contained, as required by the config contract; config cannot
depend on other program declarations, including named shapes.

Modes select resolvable kind descriptors: Web, Worker, Job, Events, or an
explicitly imported custom kind. Services, repositories, managers, and entry
points are explicitly composed. Only reached dependencies are constructed,
shared dependencies once, in deterministic dependency order. Stopping or failed
startup disposes constructed resources in reverse order.

Local TypeScript imports are trusted adapter code. Metadata imports execute the
module, so adapters must not construct resources at module-load time. Factories
are deferred until startup. Host code is not an escape hatch for aggregate,
manager, or controller business logic, and grammar packages do not gain
permission to execute arbitrary host code.

## Real domain example

[counter.clsw](./examples/domain/counter.clsw) shows the specified design:
`identity id: UUID;`, `field count: NonNegativeInteger = 0;`, reusable `rule`
patterns, command input/metadata blocks, and a named event projection with bare
`emit Incremented;`. The identity is supplied, not initialized or changed by an
event. `0 | PositiveInteger` is an equivalent field contract; the integer family
also includes `NonPositiveInteger` and `NegativeInteger`. Fields accept any
Uffda pattern within Coleslaw's data and purity constraints, not just those
common names; persistence metadata remains a separate contract.

That design syntax is **not yet executable**. The
[runtime example](./examples/domain/counter-runtime.clsw) preserves the current
runnable context, aggregate, manager, and explicitly public controller. A
controller translates a shaped request into one manager operation; the manager
sends one aggregate command. The command emits events, which evolve fields
before conditional atomic save. Patterns and expressions execute through Uffda
with an explicit pure scope.

```sh
./cslw check examples/domain/counter-runtime.clsw
./cslw run examples/domain/counter-runtime.clsw --mode api
```

The development Web adapter listens on port 8080 by default:

```sh
curl -i http://127.0.0.1:8080/counters/c-1 \
  -H 'Content-Type: application/json' \
  -d '{"by":2}'
```

A second command decides against the saved state and advances its event version.
Invalid shapes, undeclared body keys/query parameters, malformed JSON, and
unsupported media types are refused. Unknown routes return 404; an unsupported
method on a matching path returns 405 with `Allow`. Stop with Ctrl+C.

Contexts declare named bindings and ordered dependencies explicitly. For
example, `counter: Counter;`, `manager: CounterManager(counter);`, and
`export http: CounterController(manager);` compose the counter path without
ambient same-context access. A mode reaches the controller as
`CounterContext.http`. Aliases may configure the same declaration more than
once; aggregate capabilities remain identified by context and aggregate
declaration, not by alias, and never expose aggregate storage.

The command/handler input-and-metadata blocks, reusable Uffda `rule` patterns,
maybe-by-default member access, and command-derived event projections are
specified but are not all implemented by this executable slice. In particular,
the runtime example's command syntax and event declaration/runtime model remain
the earlier form. The design example requires the common Type catalog and
absence-propagating member access; the HTTP path currently supplies no command
metadata, so `metadata.reason` illustrates access to absent optional metadata.

## Scope and verification

This is an initial executable slice, not the entire specified language.
Unsupported declarations fail explicitly rather than accepting opaque bodies.
General service declarations, authentication/middleware, projections, queues,
modeled errors, attached messages, production delivery/storage, and formatting
remain future slices. Worker/Events infrastructure does not imply implemented
domain consumer/reactor grammar.

The counter uses **process-local, non-durable memory storage**. State and
pending events are recorded together, but pending events are not delivered.
Restarting loses state. Do not deploy this example as production persistence.

Requirement-citing tests cover grammar, imports, config/selection, composition,
cleanup, artifacts, aggregate concurrency/failure semantics, and a real loopback
HTTP listener. Specifications are authoritative; requirements, tests, and
implementation follow them. See the
[implementation plan](./docs/implementation-plan.md) and
[specification index](./.agents/specifications/README.md).
