---
id: application-shell-008
title: Validate built-in and imported host descriptors through one boundary
spec_ref: ".agents/specifications/application-shell.spec.md#host-boundary"
---

# Host descriptors

## Requirement

Preconditions:

- Components use built-in kinds, or a Kith component or Rust host driver
  registered the way Kith's built-ins are.

Expected behavior:

- Imported custom mode kinds MUST resolve as names using ordinary import syntax.
- Descriptors MUST declare component kind and parameter contracts.
- Malformed descriptors, unexported host names, and invalid component arguments
  MUST be diagnosed before any host driver starts.
- Built-in mode capabilities MUST NOT be overridden by config or shadowed
  silently by imports.
- Parsing and checking MUST NOT start host drivers or run turns.
- Host adapters MUST NOT be TypeScript modules, and MUST NOT expose aggregate
  or manager domain behavior as an escape hatch around the language's
  capabilities.

Postconditions:

- Execution constructs only the validated descriptors reached by the chosen mode.
- Tests: `tests/compiler.rs`.
