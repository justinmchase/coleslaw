---
id: compiler-001
title: cslw parses and checks with the embedded grammar and defers lowering
spec_ref:
  - ".agents/specifications/application-shell.spec.md#cli-and-artifacts"
  - ".agents/specifications/overview.spec.md#compilation"
  - ".agents/specifications/overview.spec.md#project"
---

# Compiler commands

## Requirement

Preconditions:

- The published `uffda` CLI has compiled `src/grammar/application.uff`.
- `cslw` embeds that grammar and links `uffda-runtime` and `kith-runtime`.

Expected behavior:

- `cslw --version` MUST print the compiler version.
- `cslw parse` MUST print a syntax tree and MUST NOT start a component.
- `cslw check` MUST resolve and validate a program and MUST NOT start a host
  driver or run a turn. A valid program MUST print `ok`.
- `cslw compile` of a checked program MUST fail with the diagnostic
  `lowering this program to a Kith scene is the next step` and MUST NOT write
  an artifact.
- `cslw run` of a checked program MUST fail with that same diagnostic and MUST
  NOT dispatch a scene.
- `cslw run` of an artifact whose `version` is not the compiler version MUST
  fail with `incompatible artifact version`.
- `cslw run` of an artifact that lists a dependency with `present` false MUST
  fail with `stale dependency` and the specifier, and MUST NOT execute it.
- `cslw fmt` MUST fail as an unknown command and MUST NOT report formatting as
  implemented.
- Invalid commands and invalid source MUST produce a diagnostic and a nonzero
  exit.

Postconditions:

- Deno, a TypeScript host factory, and a second compiler are not required.
- Tests: `tests/compiler.rs`.
