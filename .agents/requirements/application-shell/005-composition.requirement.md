---
id: application-shell-005
title: Validate explicit component dependencies and capability boundaries
spec_ref: ".agents/specifications/application-shell.spec.md#explicit-composition"
---

# Composition validation

## Requirement

Preconditions:

- A mode declares components in named composition sections.

Expected behavior:

- Missing bindings, duplicate binding names, incorrect argument counts or
  capability kinds, dependency cycles, and inappropriate entry-point sections
  MUST fail checking.
- Dependencies MUST be explicitly named; no constructor-discovery injection is
  allowed.
- Controllers MUST NOT gain unrestricted domain services or aggregate mutation
  through injection.
- Repository injection MUST NOT grant managers direct aggregate-storage access.
- Web mode MUST NOT grant full traversal through composed components.

Postconditions:

- A checked graph contains only supported, explicitly validated dependency edges.
- Tests: application-shell composition tests under `test/`.
