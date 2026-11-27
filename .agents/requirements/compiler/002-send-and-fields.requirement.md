---
id: compiler-002
title: Check declarations with Kith send and field rules
spec_ref:
  - ".agents/specifications/aggregates/fields.spec.md#fields"
  - ".agents/specifications/managers.spec.md#the-command"
  - ".agents/specifications/overview.spec.md#dependency-rules"
---

# Send and field checks

## Requirement

Preconditions:

- The source parses with the current Coleslaw grammar.
- A manager parameter is a port. An aggregate field is declared on the
  aggregate, not on a state.

Expected behavior:

- A field name MUST be unique on its aggregate. A second declaration MUST fail
  checking.
- A state MUST NOT declare a field. An assignment MUST name a field declared
  on the aggregate. An unknown field MUST fail checking.
- A command handler MUST NOT assign fields. Only an event handler may assign
  a declared field.
- A manager send MUST name one of that manager's parameters. Naming the
  aggregate declaration instead MUST fail, and the diagnostic MUST say to name
  the port.
- The command MUST be declared on the aggregate that parameter's type names.
- A controller route MUST name a manager parameter and an operation of that
  manager. Naming the manager declaration instead of the port MUST fail.
- Checking MUST NOT construct actors, start host drivers, or run turns.
- Context bindings MUST still resolve independent of source order.

Postconditions:

- A checked program has not been lowered to a Kith scene.
- Tests: `tests/compiler.rs`.
