# Application shell implementation plan

**Retired as a build plan.** This document records the Deno slice that shipped
in #16 and #17. That toolchain is removed. Coleslaw is a Rust project on
`uffda-runtime` and `kith-runtime`. It does not reimplement those libraries,
load TypeScript from JSR, or keep a second compiler. The Rust `cslw` workspace
parses and checks. `compile` and `run` wait until a program is lowered to a
Kith scene. Do not follow the TypeScript and Deno stages below. Specifications
are authoritative.

## Goal

The retired goal was a `cslw` CLI and a modular Uffda grammar that can parse,
check, compile, and start a small Coleslaw application. The grammar remains.
The Rust compiler embeds that grammar, compiled by the published `uffda` CLI,
and links `uffda-runtime` and `kith-runtime`. `parse` and `check` run.
`compile` and `run` wait for lowering.

## Confirmed direction

The language decisions below still hold. The toolchain sentences do not.

- Write the grammar in `.uff` files. Compile it with the published `uffda`
  CLI. Do not fork or copy Uffda internals, and do not reimplement Kith.
- Preserve Uffda's import and export syntax, including explicit imported names.
- Support built-in and explicitly imported mode kinds. In `mode PublicApi: Web`,
  `Web` is a resolved descriptor, not a reserved grammar keyword.
- The Web mode keeps the former API kind's HTTP semantics and its prohibition
  on full traversal.
- Use explicit services, repositories, managers, and controllers composition.
  No automatic dependency injection, constructor discovery, or ambient access
  to every component through a context object.
- A host implementation is a Kith component or a Rust host driver. It is not
  a TypeScript module. Domain behavior stays constrained Coleslaw.
- Bind named config with nested settings, shapes, and the `secret` modifier.
  Defaults and parsing remain Uffda patterns rather than a second type system.
- Select modes using a settings-to-mode map with short labels such as `api`,
  `worker`, `events`, and `job`. Unmatched selection fails.
- Support declared positional argument bindings to settings. A Job mode may
  contain multiple jobs but runs exactly one selected job.
- Commands are `parse`, `check`, `compile`, and `run`. `fmt` stays deferred.
- A long-running business process is an aggregate state machine. A deadline is
  Kith's `Timer` or `send after`. Do not add a workflows chapter or a timers
  chapter.

## Proposed syntax

These sketches established the direction. The `./infra.ts` import from the
Deno slice is retired. The names it imported are host drivers, not files.

```text
import "./config.clsw" Settings;
import "./catalog/context.clsw" Catalog;

export mode PublicApi: Web {
  services {
    Logging logging;
    Mongo db;
  }
  repositories {
    MongoRepository(db, "catalog") catalogs;
  }
  managers {
    Catalog.Manager(logging, catalogs) catalogManager;
  }
  controllers {
    Catalog.Http(logging, catalogManager);
  }
}

export program Shop {
  config Settings settings;

  mode settings.mode {
    "job"    => Jobs(settings.jobName);
    "worker" => OrderWorkers(settings.workerLabel);
    "events" => EventProcessing;
    "api"    => PublicApi;
  }
}
```

`Jobs`, `OrderWorkers`, and `EventProcessing` are separately declared modes.
Right-hand sides select and bind modes; they are not general function calls.
Importing `Web` explicitly or substituting an imported custom descriptor uses
the same name resolution as other dependencies.

Repository bindings provide declared runtime storage or projection-read
adapters. They do not let a manager load or write aggregate storage directly.
Controller injection is limited to declared infrastructure capabilities, such as
logging or authentication, and its ordinary managers/projections. Domain queries
and effects keep their existing layer restrictions.

The sketch's `Catalog.Manager` composition is illustrative, not permission to
export a manager. The modules specification forbids exporting managers and
aggregates from a context. The checked domain slice must compose the exported
controller's internal manager dependencies without exposing them across
contexts; the implementation must reject boundary violations.

An API label can select a Web mode containing controllers from several contexts.
Those controllers reach multiple managers and aggregate kinds; one-aggregate
atomicity remains a rule per command, not per mode.

## Reference application findings

The composition reference is
[deploy-approval-api](https://github.com/justinmchase/deploy-approval-api):

- [`initContext`](https://github.com/justinmchase/deploy-approval-api/blob/main/src/mod.ts)
  creates logging, then services, repositories, and managers.
- [`initServices`](https://github.com/justinmchase/deploy-approval-api/blob/main/src/services/mod.ts)
  constructs config-backed GitHub, Mongo, and authentication services.
- [`initRepositories`](https://github.com/justinmchase/deploy-approval-api/blob/main/src/repositories/mod.ts)
  explicitly passes Mongo to each repository.
- [`initManagers`](https://github.com/justinmchase/deploy-approval-api/blob/main/src/managers/mod.ts)
  passes specific repositories to each manager.
- [`initControllers`](https://github.com/justinmchase/deploy-approval-api/blob/main/src/controllers/mod.ts)
  constructs controllers with specific dependencies and registers them in order.

Borrow this explicit composition and registration order, not unrestricted
repository writes, controller service calls, inheritance, or host-written domain
logic.

## Stages and dependencies

These stages are the retired Deno sequence. They are not instructions for the
Rust compiler.

### 1. Establish the Uffda integration boundary

This stage consumed published TypeScript APIs from JSR, including loading
local TypeScript descriptors. That dependency is removed. The Rust project
links `uffda-runtime` and `kith-runtime` and compiles the grammar with the
published `uffda` CLI. It does not load a TypeScript package, and it does not
vendor those libraries.

### 2. Specify the application shell and composition

Depends on stage 1's verified API boundary, not necessarily its release.

Read the specs/requirements skills before editing their respective layers.
Update [modes](../.agents/specifications/modes.spec.md),
[startup](../.agents/specifications/startup.spec.md),
[config](../.agents/specifications/config.spec.md),
[modules](../.agents/specifications/modules.spec.md), and related cross-links.
Add focused grammar/CLI/composition contracts as needed.

Resolve:

- Web naming across every existing API reference, without changing capabilities;
- program selection labels, defaults, shaped mode parameters, and
  exactly-one-job selection;
- positional settings mapping, named-argument precedence, unknown/extra
  arguments, and secret-safe diagnostics;
- staged config resolution: selector settings first, then selected-mode
  settings, without demanding credentials for unused components;
- typed component parameters, binding scopes, explicit dependency edges,
  construction/registration order, cycles, and teardown after partial startup;
- infrastructure capabilities without opening domain layer access;
- built-in registration versus explicit imports and duplicate-name diagnostics;
- artifact schema/versioning and the distinction between syntax and checked IR.

Keep `cslw` as the requested executable name and retain the specified
source/project/lock names `.clsw`, `clsw.jsonc`, and `clsw.lock` in this slice.
Do not perform an unrelated project-format rename.

Autonomous syntax decisions use explicit positional mappings and named mode
parameters, with named flags above positionals above environment input. They
must be recorded in the grammar contract and demonstrated by tests.

### 3. Requirements and tests for the foundation

Depends on stage 2's contracts. Write narrow requirements with stable IDs and
specific `spec_ref` anchors. Add tests citing each as `req:{id}` before its
implementation. Do not leave requirements with nonexistent placeholder tests.

Test:

- exact ASTs, source locations, complete-input parsing, and malformed syntax;
- identical Uffda import syntax, explicit exports, missing names, and
  collisions;
- config nesting, defaults, optional values, source precedence, secret
  redaction;
- built-in/imported kinds, composition argument shapes, illegal layer access;
- missing/multiple defaults, unmatched labels, and mode argument validation;
- positional job name binding and exactly one executed job;
- only reached dependencies being validated and constructed;
- deterministic construction, ordered controller registration, startup failures;
- checked artifacts, stale/incompatible artifacts, and nonzero CLI failures.

### 4. Implement grammar, semantic checking, and CLI

Depends on stage 3, with implementation following tests incrementally.

Use modular `.uff` grammar files for imports, exports, config, program, modes,
and composition. The Deno slice used TypeScript for the AST, checking,
artifacts, the CLI, and host factories. That implementation is removed. The
replacement is the Rust `cslw` crate, which this document does not start.

The pipeline is source, then a syntax tree, then a checked program, then mode
selection, then reached config, then construction of the Kith scene. Parsing
and checking must not start host drivers or run turns.

`parse` prints syntax; `check` validates semantics; `compile` writes checked
artifacts; `run` executes only a selected, validated mode. Unsupported
constructs produce explicit diagnostics, not empty placeholder behavior.

### 5. Deliver a runnable application shell

Depends on stage 4 and the available upstream dependency.

Provide a small example demonstrating config, a short mode label, explicit
injection, an imported mode kind, job positional selection, startup, and
shutdown. Use a test adapter where a domain engine is not implemented yet; label
it honestly rather than claiming a complete Web or aggregate runtime.

Run targeted grammar/compiler/runtime tests, type-check, formatting/linting, the
specs audit, CLI integration tests, and the example. Verify that one job
executes, unused services are not constructed, and failed startup is reported.

### 6. Grow into a real domain application

After the shell, add service/context declarations and a minimal working
aggregate -> manager -> controller path. Add remaining declaration kinds through
complete slices with requirement-citing tests, not generic opaque bodies
accepted for every keyword.

A long-running business process is an aggregate state machine. A deadline is
Kith's `Timer` or `send after`. Do not add those chapters. Leave formatting
and production adapters until `cslw run` covers one real program.

## Review workflow

Push plan, contract, test, and implementation updates to the same Coleslaw PR
while open. Clearly identify upstream prerequisites and incomplete runtime
surfaces. The maintainer reviews and merges; do not merge automatically.

## Implementation progress

This section describes the Deno slice removed from the tree. Those tests, the
CLI, and the TypeScript host factories are gone. Do not treat the pass counts
below as the current build.

The approved plan was merged in #16. The Deno implementation landed in #17.

- The public Uffda integration prerequisites are implemented in
  [justinmchase/uffda#270](https://github.com/justinmchase/uffda/pull/270). Its
  current integration commit is `503ee800e610862d390fd1caaf85f7533214b780`,
  including the public expression evaluator and runtime exports. Focused
  upstream validation and CI passed. The APIs are now consumed from Uffda 0.9.2,
  which fixes published-package grammar loading. Local development and CI use
  the released CLI and JSR dependencies, without a sibling-checkout mapping or
  source build.
- The application-shell specification and requirements are committed, including
  Web naming, settings selection, explicit composition, and host boundaries.
- The initial pure aggregate kernel has 17 passing requirement-citing tests.
  These verify event-driven evolution, ordered transitions, atomic memory saves,
  bounded conflict retries, immutable identity, and uncertain-save warnings.
- Grammar, CLI, composition, and both runnable examples are implemented. Uffda
  0.9.2 fixes the
  [JSR built-in grammar defect](https://github.com/justinmchase/uffda/issues/271)
  encountered in 0.9.1. All 56 tests pass using published JSR dependencies only,
  including real loopback HTTP and shape/parameter checks. The local suite takes
  about 22 minutes with published-package resolution. Released-CLI grammar
  compilation, type checking, lint, formatting, and the specification audit
  pass. A checked Counter artifact was started and verified over HTTP: two
  increments yielded counts 2 and 5 with versions 1 and 2; the smoke-test
  process was stopped afterwards.
- Follow-up validation fixed controller-wide routing and `Allow`, shaped path
  routing, explicit imported config binding, private import scoping, genuine
  stale-input detection, custom project output directories, launcher working
  directories, and secret redaction during mode execution.
- Named reusable shapes and shaped mode parameters are implemented, including
  imported shape scope, cycle detection, argument arity, shaped values, and
  parameter injection before factories run. General service declarations remain
  outside the current executable subset. Do not present the entire six-stage
  plan as complete while those declarations are missing.

The memory store is a development adapter, not durable production storage or
event delivery. Modeled errors, attached messages, projections, and production
delivery are not implemented by the initial aggregate kernel.
