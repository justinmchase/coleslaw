# Application shell implementation plan

This is an implementation proposal, not a new normative specification.
Specifications remain authoritative. Each stage updates the relevant contract
before adding requirements, requirement-citing tests, and implementation.

## Goal

Build a `cslw` CLI and a modular Uffda grammar that can parse, check, compile,
and start a small Coleslaw application. Start with config, program, modes, and
explicit composition; grow domain constructs through working vertical slices.
Keep related Coleslaw work in one open PR. Upstream Uffda changes necessarily
belong to that repository and should be coordinated as prerequisites.

## Confirmed direction

- Write the grammar in `.uff` files. Use Uffda's compiler, tokenizer, patterns,
  expressions, matching, diagnostics, and resolution through public JSR APIs.
  Add a thin Coleslaw semantic layer; do not fork or copy Uffda internals.
- Preserve Uffda's import/export syntax, including explicit imported names.
- Support built-in and explicitly imported mode kinds. In
  `mode PublicApi:
  Web`, `Web` is a resolved descriptor, not a reserved
  grammar keyword.
- Rename the existing API mode kind to Web. Keep its restrictions, including
  prohibiting full traversal through managers or in-process reactors.
- Use explicit services, repositories, managers, and controllers composition. No
  automatic dependency injection, constructor discovery, or ambient access to
  every component through a context object.
- Host implementations and mode adapters may be TypeScript. Domain behavior
  stays constrained Coleslaw; injection does not grant new domain capabilities.
- Bind named config with nested settings, shapes, and the `secret` modifier.
  Defaults and parsing remain Uffda patterns rather than a second type system.
- Select modes using a settings-to-mode map with short labels such as `api`,
  `worker`, `events`, and `job`. Unmatched selection fails automatically.
- Support declared positional argument bindings to settings. A Job mode may
  contain multiple jobs but runs exactly one selected job.
- Start with `parse`, `check`, `compile`, and `run`. Defer `fmt`, while keeping
  the grammar and source locations suitable for adding it later.

## Proposed syntax

These sketches establish the direction; parameter declarations, binding
spelling, and positional mappings need specification before implementation.

```text
import "./config.clsw" Settings;
import "./catalog/context.clsw" Catalog;
import "./infra.ts" Logging Mongo MongoRepository;

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

### 1. Establish the Uffda integration boundary

Inspect the sibling Uffda repository and its specifications/tests. Verify the
published API, not merely symbols available on local main. Published 0.9.0
exports the grammar compiler and execution engine, but its grammar package
exports currently offer only the tokenizer.

Define and implement the smallest upstream prerequisites needed to:

- import pattern, expression, import/export, and language metadata grammar
  components through supported package exports;
- compile and execute the Coleslaw `.uff` grammar without a copied parser;
- parse foreign-language source to its own typed syntax tree;
- reuse project/import-map/artifact resolution with Coleslaw file names;
- load validated local TypeScript descriptors without treating arbitrary
  Coleslaw nodes as Uffda runtime declarations.

Test these APIs upstream and use an explicit local-development mapping while
unpublished. Switch to a published JSR version before presenting the Coleslaw
deliverable as independently installable. Preserve the restriction against
loading host code from grammar packages unless deliberately revised upstream.

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

Use modular `.uff` grammar files for imports/exports, config, program, modes,
and composition. Use TypeScript for AST types, semantic checking, artifact I/O,
CLI orchestration, and host adapters.

The pipeline is source -> syntax AST -> resolved, checked application IR -> mode
selection -> reached config -> explicit construction -> execution. Parsing and
checking must not execute imported factories or start components. Host modules
must not construct resources at module-load time.

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

Defer workflows, timers, additional operational specifications, formatting, and
production adapters until the foundation can express and run a real app.

## Review workflow

Push plan, contract, test, and implementation updates to the same Coleslaw PR
while open. Clearly identify upstream prerequisites and incomplete runtime
surfaces. The maintainer reviews and merges; do not merge automatically.

## Implementation progress

The approved plan was merged in #16. Implementation continues in #17.

- The public Uffda integration prerequisites are implemented in
  [justinmchase/uffda#270](https://github.com/justinmchase/uffda/pull/270). Its
  current integration commit is `503ee800e610862d390fd1caaf85f7533214b780`,
  including the public expression evaluator and runtime exports. Focused
  upstream validation and CI passed. It is not merged or published. Development
  and CI must use an explicit mapping to this checkout until a compatible JSR
  release exists.
- The application-shell specification and requirements are committed, including
  Web naming, settings selection, explicit composition, and host boundaries.
- The initial pure aggregate kernel has 17 passing requirement-citing tests.
  These verify event-driven evolution, ordered transitions, atomic memory saves,
  bounded conflict retries, immutable identity, and uncertain-save warnings.
- Grammar, CLI, composition, and both runnable examples are implemented. The
  current suite has 51 passing tests, with type checking, lint, formatting, and
  the specification audit passing. A checked Counter artifact was started and
  verified over HTTP: two increments yielded counts 2 and 5 with versions 1 and
  2; the smoke-test process was stopped afterwards.
- Follow-up validation fixed controller-wide routing and `Allow`, shaped path
  routing, explicit imported config binding, private import scoping, genuine
  stale-input detection, custom project output directories, launcher working
  directories, and secret redaction during mode execution.
- Named reusable shapes and arbitrary shaped mode parameters remain contract
  gaps under active implementation. General service declarations remain outside
  the current executable subset. Do not present the entire six-stage plan as
  complete while these surfaces are missing.

The memory store is a development adapter, not durable production storage or
event delivery. Modeled errors, attached messages, projections, and production
delivery are not implemented by the initial aggregate kernel.
