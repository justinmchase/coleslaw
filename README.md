# Coleslaw

A constrained business-application language built with
[Uffda](https://github.com/justinmchase/uffda). Its modular `.uff` grammar
reuses Uffda's tokenizer, patterns, expressions, and import syntax. TypeScript
supplies semantic checking, explicit composition, runtime adapters, and the
`cslw` CLI; domain decisions remain declarative Coleslaw.

## Development prerequisite

This implementation requires the public integration APIs in
[justinmchase/uffda#270](https://github.com/justinmchase/uffda/pull/270). The
target Uffda version is **0.9.1**, which is not published yet. This is a
source-run development setup, not an independently installable JSR release.

Use Deno 2 and a sibling `../uffda` checkout at commit
`503ee800e610862d390fd1caaf85f7533214b780`. In a fresh Uffda checkout, build its
grammar artifacts using `deno task compile:lang` with the Uffda CLI installed.
That task replaces Uffda's `bin` artifacts; do not run it over artifacts you
need to preserve. The pinned setup is also exercised by
[CI](./.github/workflows/checks.yml).

[deno.dev.jsonc](./deno.dev.jsonc) maps supported Uffda TypeScript entry points
to the sibling checkout. `COLESLAW_UFFDA_ROOT` explicitly maps grammar-package
resolution to its compiled artifacts. The development CLI launcher configures
both; no private copied parser or silently substituted published API is used.

```sh
uffda compile --config clsw.jsonc 'src/grammar/*.uff'
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

[counter.clsw](./examples/domain/counter.clsw) declares a context, aggregate,
manager, and explicitly public controller. A controller translates a shaped
request into one manager operation; the manager sends one aggregate command. The
command emits events, which evolve fields before conditional atomic save.
Patterns and expressions execute through Uffda with an explicit pure scope.

```sh
./cslw check examples/domain/counter.clsw
./cslw run examples/domain/counter.clsw --mode api
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

Contexts expose controllers, not their aggregates or managers. Controller
composition must preserve those boundaries; explicit injection does not
authorize cross-context access or direct storage reads.

## Scope and verification

This is an initial executable slice, not the entire specified language.
Unsupported declarations fail explicitly rather than accepting opaque bodies.
General service declarations, named reusable shapes, arbitrary shaped mode
parameters, authentication/middleware, projections, queues, modeled errors,
attached messages, production delivery/storage, and formatting remain future
slices. Worker/Events infrastructure does not imply implemented domain
consumer/reactor grammar.

The counter uses **process-local, non-durable memory storage**. State and
pending events are recorded together, but pending events are not delivered.
Restarting loses state. Do not deploy this example as production persistence.

Requirement-citing tests cover grammar, imports, config/selection, composition,
cleanup, artifacts, aggregate concurrency/failure semantics, and a real loopback
HTTP listener. Specifications are authoritative; requirements, tests, and
implementation follow them. See the
[implementation plan](./docs/implementation-plan.md) and
[specification index](./.agents/specifications/README.md).
