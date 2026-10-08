---
id: application-shell-001
title: Parse the application shell with Uffda grammar
spec_ref: ".agents/specifications/application-shell.spec.md#grammar-and-compilation"
---

# Application shell grammar

## Requirement

Preconditions:

- The application grammar has been compiled from `.uff` source using Uffda.

Expected behavior:

- Imports, exports, named shapes, nested config, program mappings, and mode
  composition MUST produce typed syntax nodes rather than opaque source bodies.
- Parsing MUST consume the entire input and retain diagnostic source positions.
- Malformed declarations, trailing junk, and unsupported domain declarations
  MUST be diagnosed; recovered input MUST NOT count as a clean parse.
- Patterns and expressions MUST be parsed using Uffda grammar components.

Postconditions:

- Parsing constructs no application resources.
- Tests: application-shell grammar tests under `test/`.
