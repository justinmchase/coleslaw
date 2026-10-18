---
id: application-shell-006
title: Construct reached components once and clean up in reverse order
spec_ref: ".agents/specifications/application-shell.spec.md#explicit-composition"
---

# Reached graph lifecycle

## Requirement

Preconditions:

- A selected mode has a valid composition graph and resolved reached settings.

Expected behavior:

- Dependencies MUST be constructed before dependents and shared bindings once
  per run.
- Unreached components MUST NOT be constructed.
- Independent bindings and controller registration MUST follow declaration
  order.
- On startup failure, already-constructed resources MUST be disposed in reverse
  construction order and the invocation MUST fail explicitly.
- Normal stopping MUST dispose resources in the same reverse order.
- Cleanup failures MUST be surfaced rather than discarded.

Postconditions:

- Startup cannot report success after a construction or cleanup failure.
- Tests: application-shell lifecycle tests under `test/`.
