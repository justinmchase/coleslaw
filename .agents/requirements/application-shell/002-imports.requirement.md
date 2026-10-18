---
id: application-shell-002
title: Resolve explicit imports and exports without name collisions
spec_ref: ".agents/specifications/application-shell.spec.md#grammar-and-compilation"
---

# Explicit module resolution

## Requirement

Preconditions:

- A source graph contains local Coleslaw modules and an import map.

Expected behavior:

- `import "specifier" Name OtherName;` MUST import only explicitly exported names.
- Relative paths MUST resolve from the importing file, not the process's working
  directory.
- An unresolved module or missing export MUST report the importing source and
  offending dependency.
- Duplicate local names and collisions between imports and declarations MUST
  fail checking.
- A module's explicit name export MUST refer to an available declaration.

Postconditions:

- Checking MUST NOT execute component factories.
- Tests: application-shell resolution tests under `test/`.
