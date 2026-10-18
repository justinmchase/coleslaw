---
id: application-shell-008
title: Validate built-in and imported host descriptors through one boundary
spec_ref: ".agents/specifications/application-shell.spec.md#host-boundary"
---

# Host descriptors

## Requirement

Preconditions:

- Components use built-in kinds or explicit imports from a local TypeScript module.

Expected behavior:

- Imported custom mode kinds MUST resolve as names using ordinary import syntax.
- Descriptors MUST declare component kind and parameter contracts.
- Malformed descriptors, unexported host names, and invalid component arguments
  MUST be diagnosed before factory invocation.
- Built-in mode capabilities MUST NOT be overridden by config or shadowed
  silently by imports.
- Parsing and checking MUST NOT call factories or start resources.
- Host adapters MUST NOT expose TypeScript aggregate/manager domain behavior as
  an escape hatch around the language's capabilities.

Postconditions:

- Execution constructs only the validated descriptors reached by the chosen mode.
- Tests: application-shell host-adapter tests under `test/`.
