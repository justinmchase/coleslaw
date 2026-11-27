# Coleslaw

A constrained language for business applications. Its grammar is Uffda. It
runs on Kith. Components, scenes, and message dispatch stay Kith's. Coleslaw
adds domain declarations and the rules about which messages those declarations
may send.

Coleslaw is a Rust project on `uffda-runtime` and `kith-runtime`. It does not
reimplement those libraries. The published `uffda` CLI compiles the `.uff`
grammar, and the `cslw` binary embeds that grammar. `parse` and `check` are
implemented. `compile` and `run` fail with a diagnostic until a program is
lowered to a Kith scene. Deno, JSR TypeScript packages, and TypeScript host
factories are not part of the project.

## What is in this tree

Source files use `.clsw`. Projects use [clsw.jsonc](./clsw.jsonc) and
[clsw.lock](./clsw.lock). The grammar is
[src/grammar/application.uff](./src/grammar/application.uff) and
[src/grammar/domain.uff](./src/grammar/domain.uff). `clsw.jsonc` names Uffda's
grammar packages the way the published `uffda` CLI names them. That import map
is not a TypeScript dependency.

`cslw` commands are `parse`, `check`, `compile`, `run`, and `--version`. `fmt`
stays deferred. `parse` prints a syntax tree. `check` resolves and checks
without constructing actors. `compile` and `run` report that lowering the
program to a Kith scene is the next step. Invalid input and runtime failure
exit nonzero. Checking does not start host drivers or run turns.

## Settings and explicit composition

The [Types specification](./.agents/specifications/types.spec.md) defines the
value and identity model. It is a design contract, not implemented syntax yet.
[counter.clsw](./examples/domain/counter.clsw) is that design.
[counter-runtime.clsw](./examples/domain/counter-runtime.clsw) is the earlier
slice's source. Nothing in this tree executes either file.

```text
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

`ExampleJob` is a Kith component or a Rust host driver. It is not a
TypeScript module.

Config supports nested settings, Uffda patterns, and `secret` settings with
redacted diagnostics. Precedence is named flags, positional bindings,
environment input, then pattern defaults. Resolve selector settings first;
credentials needed only by unselected modes are not required.

The [config specification](./.agents/specifications/config.spec.md) treats
config as an object pattern: map source names to setting paths, merge raw
strings by precedence, then match and project them into canonical config
values. Patterns perform parsing and coercion, not the source-merging layer.
For example:

```text
githubAppId: Number? -> (toint (default _ 372035));
```

Here `Number` matches numeric text (`string & [Digit+]`); `toint` produces the
integer. Invalid supplied text must fail, not fall back to a default. The
[deploy approval config design](./examples/design/deploy-approval-config.clsw)
shows the full declaration, with credentials marked `secret` for redaction.
Unwrapped setting patterns and these common text-pattern names are specified
design syntax. The current grammar still uses the parenthesized form.

Reusable shapes and explicitly shaped mode parameters are specified:

```text
export shape JobName = (string);
export mode Batch(jobName: (JobName)): Job {
  jobs {
    ExampleJob example;
  }
}
```

Selection arguments match the ordered parameter shapes before construction.
The
[Job specification](./.agents/specifications/jobs.spec.md#explicit-job-selection-mappings)
also defines explicit dispatch, which the grammar does not implement yet:

```text
export context CounterContext {
  counter: Counter;
  manager: CounterManager(counter);
  export increment: IncrementJob(manager);
  export decrement: DecrementJob(manager);

  export mode JobMode(name: String): Job {
    jobs(name) {
      "inc" -> this.increment;
      "dec" -> this.decrement;
    }
  }
}
```

`this` is the running mode's owning context instance. Exactly one pattern must
match. Only the selected job's graph is reached.

Modes select resolvable kind descriptors: Web, Worker, Job, Events, or an
explicitly imported custom kind. Services, repositories, managers, and entry
points are explicitly composed. Only reached dependencies are constructed,
shared dependencies once. A service implementation is a Kith component or a
Rust host driver. Checking does not start it.

## Domain example

[counter.clsw](./examples/domain/counter.clsw) shows the specified design:
`identity id: UUID;`, `field count: NonNegativeInteger = 0;`, reusable `rule`
patterns, command input and metadata blocks, and a named event projection.
The identity is supplied, not minted inside a handler.

That design syntax is not executable. The runtime example preserves the
earlier context, aggregate, manager, and controller source. A controller
causes one manager operation; the manager causes one aggregate command. Each
of those steps is a message send. Patterns and expressions are Uffda's, and
Coleslaw does not ship a private evaluator.

The shell example at [examples/shell/app.clsw](./examples/shell/app.clsw) shows
config, a short mode label, and one selected job. The job is a host driver,
not a file in this repository.

## Specifications

Specifications are authoritative. See the
[specification index](./.agents/specifications/README.md). The
[implementation plan](./docs/implementation-plan.md) records the removed Deno
slice. Do not treat it as the current build plan.

The application-shell requirements still state the `cslw` contract. Nothing
in this tree cites them until the Rust compiler lands.
