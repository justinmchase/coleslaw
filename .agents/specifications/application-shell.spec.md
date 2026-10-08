# Application shell

This chapter defines the first executable Coleslaw application shell: grammar,
program selection, explicit composition, CLI, and host adapters. Existing domain
chapters remain authoritative; this shell does not permit host-written domain
logic or unrestricted dependency injection.

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Grammar and compilation

- Coleslaw's grammar MUST be modular Uffda `.uff` source. The implementation
  MUST reuse Uffda's tokenizer, patterns, expressions, compiler, matching, and
  import syntax rather than implement a competing parser or copy its internals.
- Coleslaw MUST add a typed syntax AST and a thin semantic checking layer.
  Syntax and checked application artifacts MUST remain distinct.
- Imports MUST use `import "specifier" Name OtherName;`; exports MUST be explicit.
  Every imported name MUST be exported, and local/imported names MUST be unique.
- The first runnable subset MUST support config, program, mode, composition,
  and named shapes. Unsupported domain declarations MUST produce a diagnostic,
  not an opaque accepted body or a successful no-op.
- Parse diagnostics MUST identify source and position. Parsing MUST consume
  the full input; recovery MUST NOT turn invalid input into a clean success.
- Source extensions and project/lock files remain `.clsw`, `clsw.jsonc`, and
  `clsw.lock`. The executable MUST be named `cslw`.

## Settings and selection

- A named config MUST contain a tree of settings with Uffda patterns, including
  nested groups and the `secret` modifier. Secret values MUST NOT appear in
  diagnostics. Defaults, optionality, and parsing MUST be expressed by patterns.
- Each setting MUST use `identifier: Pattern;`; wrapping parentheses MUST be
  optional. Source values MUST be merged before matching and projection, and
  projections MUST supply the canonical config values under
  [config](./config.spec.md#parsing-input-into-config).
- A program MUST bind one config declaration to a local name and declare a
  mapping from a setting's value to mode references, optionally with arguments.
  Labels such as `api` and `job` MAY differ from mode declaration names.
- A mapping MUST have unique labels. An unmatched selector MUST fail startup,
  naming the supported labels without executing user exception code.
- A missing selector MAY use the config pattern's default. Multiple competing
  defaults MUST NOT be accepted.
- Mode arguments MUST be shaped declaration parameters. Mode binding MUST NOT
  be an arbitrary function invocation or evaluate effectful expressions.
- Named shapes MUST be declared as `shape Name = (Pattern);`, where `Pattern`
  uses Uffda's pattern syntax. Shape references MUST obey explicit imports and
  exports and MUST NOT introduce effects or recursive unbounded resolution.
  Config patterns MUST remain self-contained under
  [config](./config.spec.md#the-config-declaration), rather than depend on
  named declarations.
- A mode MAY declare an ordered parameter list before its kind, such as
  `mode Batch(jobName: (string)): Job`. A selection's arguments MUST match the
  declared parameter shapes before any reached component is constructed.
  Parameter names MUST be unique. Missing, extra, or invalid arguments MUST
  fail startup. An existing Job selection with no explicit parameters MAY
  retain its single job-name selection argument for compatibility.
- A program MAY explicitly map positional arguments onto setting paths.
  Named flags MUST take precedence over positional arguments, which take
  precedence over environment input and pattern defaults. Extra positionals
  and unknown flags MUST be refused.
- Settings needed by the selector MUST be resolved first, then selected-mode
  arguments and reached component settings. Unselected-mode credentials MUST
  NOT be required or cause unused components to be constructed.
- Job mode MUST select exactly one named job per run. A single listed job MAY
  be selected implicitly; multiple listed jobs require an explicit job name.
  Unknown jobs MUST fail before construction, listing the available jobs.

## Explicit composition

- A mode MUST refer to a resolved mode-kind descriptor, such as `: Web`.
  Built-ins MUST be available through the runtime, and custom kinds MUST be
  importable through ordinary named imports.
- Built-in kinds MUST be Web, Worker, Job, and Events. Web retains the former
  API kind's HTTP semantics and prohibition on full traversal. Kind capabilities
  MUST NOT be reconfigured by settings or component injection.
- Mode bodies MUST declare their composition explicitly in named sections:
  services, repositories, managers, and the entry-point sections appropriate
  to the kind, such as controllers, jobs, consumers, or reactors.
- A binding MUST identify its component, arguments, and local binding name.
  All dependency edges MUST be visible in this composition; automatic
  constructor discovery and ambient access to all components MUST NOT be used.
- Component parameters MUST declare expected shapes or capability kinds.
  Unknown bindings, duplicates, incorrect argument counts or types, dependency
  cycles, and sections unsupported by the selected kind MUST be rejected.
- The runtime MUST construct only the graph reached from the selected entry
  points. Dependencies MUST be constructed before their dependents.
  Independent siblings and controller registration MUST retain declaration
  order. A dependency shared by entry points MUST be constructed once per run.
- Construction failure MUST stop startup, explicitly report the failure, and
  dispose successfully constructed resources in reverse construction order.
  Normal stopping MUST use the same ordered resource cleanup; cleanup failure
  MUST be reported rather than silently discarded.
- Repositories MUST be adapters for declared runtime storage or projection
  access. Injection MUST NOT let a manager load/write aggregate storage
  directly, or circumvent event-driven aggregate mutation.
- Controllers MAY receive restricted infrastructure capabilities such as
  logging or authentication adapters. They MUST NOT gain general domain
  queries/effects or aggregate commands through injection.
- Managers and controllers from a context MUST retain its ownership and access
  constraints when explicitly composed. Mode composition MUST NOT make
  unexported domain members available to other contexts.

## Host boundary

- Local TypeScript modules MAY provide typed host descriptors for service
  implementations, runtime repositories, infrastructure capabilities, and
  mode-kind adapters. Descriptors MUST declare their kind and parameter
  contract; malformed descriptors MUST be rejected.
- Host implementations MUST be loaded through explicit imports or the runtime's
  built-in registry. Built-in and imported components MUST follow the same
  capability validation; imports MUST NOT silently shadow built-in kinds.
- Host modules MUST NOT construct resources or start work at module-load time.
  Checking MAY load descriptor metadata but MUST NOT invoke factories.
  Construction MUST happen only after selection and reached config validation.
- This host extension MUST NOT permit native Uffda expressions or TypeScript
  aggregate/manager business logic. HTTP and storage technologies stay behind
  runtime adapters.
- Package host-code restrictions MUST follow Uffda. Supporting trusted local
  TypeScript MUST NOT imply permission to execute host code from grammar packages.

## CLI and artifacts

- `cslw parse` MUST return a syntax AST without application construction.
- `cslw check` MUST resolve and validate an application without starting it.
- `cslw compile` MUST write versioned checked artifacts, with source/dependency
  provenance sufficient to detect incompatible or stale inputs.
- `cslw run` MUST select, validate, construct, run, and stop a declared mode.
  Running checked artifacts MUST reject stale or incompatible artifacts.
- Invalid source, imports, settings, descriptors, and execution failures MUST
  produce diagnostics and a nonzero process exit. A supported empty result
  MUST NOT be used as a fallback for unsupported behavior.
- Formatting is deferred. Reserving a future `fmt` command MUST NOT cause the
  initial CLI to report formatting as implemented.

## Delivery scope

- Local development and CI MUST use a released Uffda CLI and published JSR
  integration APIs. They MUST NOT load or build an Uffda repository checkout
  as a dependency. Missing released APIs MUST be reported as a dependency
  blocker rather than substituted with repository source.
- A shell demonstration MAY use a clearly labeled test mode adapter. It MUST
  NOT be presented as a complete domain runtime or production Web server.
- Domain behavior SHOULD expand through complete, requirement-citing tested
  slices, rather than placeholder syntax for every future declaration.
