---
id: application-shell-003
title: Resolve reached config with shaped defaults and secret-safe failures
spec_ref: ".agents/specifications/application-shell.spec.md#settings-and-selection"
---

# Shaped settings

## Requirement

Preconditions:

- Config declares named settings, nested groups, and optional secret settings.

Expected behavior:

- Setting inputs MUST be matched and projected by their Uffda patterns.
- Named flags MUST precede declared positionals, which precede environment
  input and pattern defaults.
- Unselected-mode-only settings MUST NOT be required for the selected mode.
- Invalid reached input MUST fail before constructing any resources.
- Errors MUST identify the setting and expected constraint without including
  a secret's supplied value.

Postconditions:

- Resolved settings retain their shaped data types.
- Tests: application-shell config tests under `test/`.
