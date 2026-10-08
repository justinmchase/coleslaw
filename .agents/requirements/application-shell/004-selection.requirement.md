---
id: application-shell-004
title: Select a mapped mode and exactly one job
spec_ref: ".agents/specifications/application-shell.spec.md#settings-and-selection"
---

# Mode and job selection

## Requirement

Preconditions:

- A program binds config and maps selection labels to declared modes.

Expected behavior:

- A matching label MUST select its declared mode and shaped arguments.
- Explicit mode parameters MUST have unique names; argument count and shapes
  MUST be checked before construction. Missing, extra, or shape-invalid
  arguments MUST fail. Parameter references MUST resolve only within their
  declared mode.
- A default selector value MUST select only one mode.
- Duplicate labels, unknown labels, unknown named arguments, and extra
  positionals MUST be diagnosed before startup construction.
- A Job mode with multiple jobs MUST require a job selection and execute only
  the named job. An unknown name MUST fail with available names.
- A Job mode with one job MAY select it implicitly.

Postconditions:

- No unselected mode or job is started.
- Tests: application-shell selection tests under `test/`.
