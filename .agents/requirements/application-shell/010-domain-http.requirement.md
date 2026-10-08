---
id: application-shell-010
title: Execute a declarative domain command through a real HTTP request
spec_ref:
  - ".agents/specifications/application-shell.spec.md#delivery-scope"
  - ".agents/specifications/modules.spec.md#the-boundary"
  - ".agents/specifications/managers.spec.md#operations"
  - ".agents/specifications/managers.spec.md#the-command"
  - ".agents/specifications/managers.spec.md#results"
  - ".agents/specifications/controllers.spec.md#routes"
  - ".agents/specifications/controllers.spec.md#binding-a-request"
  - ".agents/specifications/controllers.spec.md#authentication"
---

# Initial domain-to-HTTP slice

## Requirement

Preconditions:

- A checked application declares an aggregate, a manager operation, and a
  controller route in one context, reached by a Web mode.
- Pure patterns and expressions use Uffda; runtime storage and HTTP transport
  are adapters rather than host-written business logic.

Expected behavior:

- A real HTTP request MUST bind the declared request shapes, invoke exactly
  one manager operation, and execute its command through the aggregate kernel.
- The aggregate MUST evolve through declared events and save state and events
  atomically. A repeated request MUST decide against the saved state rather
  than reset it.
- The manager MUST check input and result shapes. It MUST NOT receive direct
  aggregate storage access or call effects. Failed command outcomes MUST retain
  any may-have-committed warning.
- The controller MUST bind its manager input through declared expressions and
  translate outcomes through declared responses, without host-written domain
  logic or direct aggregate access.
- The initial public-route subset MUST require explicit `public`; omitted
  authentication declarations and unsupported authentication MUST be refused
  at check time, not treated as anonymous success.
- Invalid request shapes and malformed JSON MUST return `400`, unsupported
  request body media types MUST return `415`, unknown paths MUST return `404`,
  and a matching path with an unsupported method MUST return `405` with `Allow`.
  Undeclared query parameters or bodies MUST NOT be silently ignored.
- Context ownership MUST be checked. A context MUST NOT export its managers or
  aggregates; modes MUST reach its exported controllers through the context.
- Stopping the mode MUST stop its listener and clean up reached resources.
  Unsupported domain constructs MUST fail explicitly.

Postconditions:

- Tests MUST exercise a real loopback HTTP listener with declarative source,
  successful mutation, repeat behavior, refusal, and cleanup.
- The example MUST identify memory storage as non-durable and MUST NOT claim
  production event delivery or unimplemented domain features.
