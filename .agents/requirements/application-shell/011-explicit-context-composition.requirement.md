---
id: application-shell-011
title: Context bindings compose domain declarations through explicit typed dependencies
spec_ref:
  - ".agents/specifications/application-shell.spec.md#explicit-composition"
  - ".agents/specifications/modules.spec.md#declaring-a-context"
  - ".agents/specifications/modules.spec.md#the-boundary"
---

# Explicit context composition

## Requirement

Preconditions:

- A context contains aggregate, manager, and controller binding declarations.
- Managers and controllers declare typed ordered dependency parameters.

Expected behavior:

- Context bindings MUST resolve aliases and declaration types independent of
  declaration order.
- Each binding's dependencies MUST match the target declaration's parameter
  count, order, and nominal declaration types. Unknown bindings, duplicate names
  or parameters, cycles, and cross-context edges MUST fail checking.
- Context binding targets and dependencies MUST be declarations in the current
  module. A context binding that names an imported aggregate, manager, or
  controller MUST fail checking with an explicit unsupported-import diagnostic;
  import alone does not make the declaration available for local composition.
- Managers MUST use an explicitly declared aggregate parameter in each command
  operation. Controllers MUST use an explicitly declared manager parameter in
  each route. Same-context ownership and importing a declaration MUST NOT grant
  unbound access.
- Aggregate capability identity MUST be the owning context and aggregate
  declaration, never the binding alias, and MUST NOT provide aggregate storage
  access.
- Only exported controller bindings of exported contexts MAY be reached by
  modes. Unreached context bindings MUST NOT be constructed.
- Checking MUST NOT invoke component factories or read aggregate storage.

Postconditions:

- Tests: context composition and boundary tests under
  `test/domain-application.test.ts`.
