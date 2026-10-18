---
id: application-shell-009
title: Execute aggregate commands through atomic event-driven evolution
spec_ref:
  - ".agents/specifications/aggregates.spec.md#handling-a-command"
  - ".agents/specifications/aggregates.spec.md#concurrency"
  - ".agents/specifications/runtime.spec.md#outcomes"
  - ".agents/specifications/aggregates/state-machines.spec.md#applying-a-decision"
---

# Initial aggregate kernel

## Requirement

Preconditions:

- A checked aggregate has fields, commands, events, states, and pure pattern
  and expression evaluation.
- Storage provides load and conditional atomic save.

Expected behavior:

- The runtime MUST Load, Decide, Evolve, Check, and Save with events in order.
- Only emitted events MAY change fields or state; an unhandled event MUST be a
  no-op and an unhandled command MUST be rejected.
- A zero-event accepted command MUST NOT call Save or increment version.
- Event/field/invariant violations MUST reject without saving.
- Conflicts MUST retry from Load up to `commandAttempts`, default three, and
  exhaustion MUST report conflicted.
- Unknown Save outcomes MUST fail with an explicit may-have-committed warning;
  failures other than conflicts MUST NOT retry.
- Loaded invalid state MUST fail rather than become a business rejection.
- Memory storage MUST copy state and atomically record events with the state.

Postconditions:

- Tests: `test/domain.test.ts` and end-to-end domain tests when integrated.
