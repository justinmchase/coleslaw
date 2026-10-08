# Errors

This chapter defines modeled errors: identified occurrences owned by an
aggregate, raised and resolved through its commands and events, and exposed
through projections. It does not replace runtime failure diagnostics, retry
policies, or the response format of the planned `problems` chapter. Terms are
defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Definitions

- A **modeled error** is a domain condition the program chooses to retain and
  show, such as an invoice that could not be delivered.
- An **error kind** is an aggregate-owned declaration naming that condition and
  the shapes of its occurrence identities and details.
- An **error occurrence** is one identified instance of an error kind, with
  details and a status: active or resolved.
- Raising creates an active occurrence. Resolving changes an active occurrence
  to resolved; it does not remove the occurrence.
- A failure diagnostic reports a defect, failed service call, or unknown commit
  result. It is not an error occurrence and cannot itself change domain state.

## Axioms

- An aggregate's stored state is its source of truth. Error occurrences are
  part of that state, not a second store or a reconstruction from event history.
- Every change to an aggregate, including an error occurrence, is described by
  an event of an accepted command.
- One command changes at most one aggregate. Recording an error on another
  aggregate is a separate command and transaction.
- An error occurrence is data, not a host exception, stack trace, or log entry.
- Delivery is at least once; commands to raise or resolve the same occurrence
  may arrive again.

## Constraints

### Ownership and declaration

- An aggregate MAY declare error kinds. Each kind MUST have a name unique among
  that aggregate's error kinds, a shape for occurrence identities, and a shape
  for occurrence details.
- Both shapes MUST accept only data; object shapes MUST be closed (see
  [patterns as types](./patterns-as-types.spec.md#closed-objects)).
- An aggregate MAY have multiple active occurrences of one kind.
- An occurrence MUST be identified by its aggregate kind and identity, its
  error kind, and its occurrence identity. Occurrence identities MUST be
  compared by data equality, never host object identity.
- Stored occurrences MUST refer to a declared kind, have an active or resolved
  status, and be unique by kind and occurrence identity within their aggregate.
- Occurrence identities MUST be supplied by the domain, such as a delivery
  request identity carried by a command. An identity generated for new work
  MUST come from the provided identity service before the command is sent.
  Evolving an error MUST NOT generate an identity.
- Error kinds MUST NOT be independent context members, services, or entry
  points. They belong to their declaring aggregate. Another context MUST NOT
  mutate its occurrences or access them by bypassing the context boundary.

### Lifecycle

- A new aggregate MUST have no error occurrences.
- Raising a kind and identity with no existing occurrence MUST create one
  active occurrence containing the supplied details.
- An existing occurrence's kind, identity, and details MUST remain unchanged.
  Raising the same kind and identity again MUST leave the existing occurrence
  unchanged, whether active or resolved; it MUST NOT duplicate or reopen it.
  Supplied details on that repeated raise do not replace the original details.
- Resolving an active occurrence MUST change only its status to resolved.
  Resolving a resolved or absent occurrence MUST leave state unchanged. The
  no-op actions do not emit events or choose command outcomes themselves.
  Resolving an absent occurrence MUST NOT create a record; it therefore does
  not suppress a later first raise of that identity.
- A new failure after resolution MUST use a new occurrence identity.
  Reusing an identity is a repeat, not a request to update the earlier failure.
- Resolved occurrences MUST remain in the aggregate's stored state. The
  runtime MUST NOT prune them, expire them, or reopen them automatically.
- Raising or resolving an occurrence MUST NOT implicitly reject commands,
  block an aggregate, change its machine state name, or resolve other
  occurrences. Any such business rule MUST be expressed by its state machine
  or invariants.

### Separation from failures

- A command rejection, conflict, runtime failure, or dead-letter disposition
  MUST NOT automatically raise or resolve a modeled error.
- A modeled error MUST NOT imply that a command failed: a command that records
  one may be accepted normally.
- Failed or rejected commands MUST NOT save error changes, except that an
  unknown Save result may have committed the entire transaction (see
  [runtime outcomes](./runtime.spec.md#outcomes)). Modeling an error MUST NOT
  hide that warning or turn an unknown outcome into a known rejection.
- A failure diagnostic MUST NOT be stored as occurrence details by the runtime.
  A program MUST choose the domain data it records explicitly.

## Mechanism

### Deciding and evolving

- A command handler MAY inspect the aggregate's error occurrences when
  choosing its ordinary events or a rejection. It MUST NOT change occurrences
  directly.
- Event handlers and their entry and exit actions MAY raise or resolve declared
  error kinds. These actions are part of evolving, computed by pure expressions
  from the event and current machine state (see
  [state machines](./aggregates/state-machines.spec.md)).
- The compiler MUST reject an error action referring to an undeclared kind or
  occurring outside aggregate evolving, naming the declaration and action.
  Managers, reactors, controllers, consumers, and jobs MUST use aggregate
  commands, not error actions.
- Error actions within one handler or entry or exit action MUST run in their
  declared order. Changes an event handler makes to occurrences MUST be
  applied before the state's exit action, just as its field changes are.
- Each decision's events MUST evolve error occurrences in event order. Error
  actions MUST NOT emit additional events, call services, or make a second
  decision. The ordinary event the program declares describes the change.
- Error actions MUST be total for existing, resolved, or absent occurrences,
  using the lifecycle's no-op rules. If the domain must reject a duplicate raise
  with different details, or a resolution of an absent occurrence, its command
  handler MUST express that rejection before evolving.
- During Check, occurrence structure, kinds, statuses, and uniqueness MUST
  satisfy this chapter; every identity and details value MUST match its kind's
  shapes, and all aggregate invariants MUST hold. A mismatch MUST
  reject the command with a reason naming the kind, occurrence, failing path,
  and expected shape, without saving any of its changes.
- Load MUST validate the same occurrence constraints against the current
  declarations. An invalid stored occurrence MUST fail handling with a
  diagnostic naming the aggregate, version, and invalid occurrence or path;
  it MUST NOT be silently dropped, repaired, or treated as a command rejection.
- Save MUST commit the complete machine state, including occurrences,
  atomically with the command's events and attached messages. The aggregate
  version MUST advance only by its emitted events, not by the number of error
  actions (see [runtime](./runtime.spec.md#handling-a-command)).
- An ignored zero-event command MUST leave errors unchanged and enqueue no
  messages. Command handlers SHOULD ignore or reject already-applied requests,
  rather than emit fresh events just to repeat an error action.
- Concurrent commands MUST follow ordinary optimistic concurrency and retry
  rules. A losing attempt MUST discard its tentative error changes and decide
  again against newly loaded state; it MUST NOT overwrite the winning
  occurrence's details or resolved status. An exhausted conflict saves none of
  that command's tentative changes.

### Lifecycle examples

These are the effects of evolving actions within a command, before Check and
Save. They are not extra command outcomes. `A` and `B` are distinct domain
occurrence identities for the same kind.

| Existing occurrences | Action | Result |
| --- | --- | --- |
| None | Raise `A` with details | `A` active with those details |
| `A` active | Raise `A` with different details | `A` unchanged |
| `A` active | Raise `B` | Both `A` and `B` active |
| `A` active, `B` active | Resolve `A` | `A` resolved; `B` unchanged |
| `A` resolved | Resolve `A` | `A` unchanged |
| `A` resolved | Delayed repeated raise of `A` | `A` remains resolved with original details |
| None | Resolve `A` | No record created |
| None, after absent resolution | Raise `A` | `A` active: no earlier occurrence was retained |

### Reads and projections

- Error occurrences MUST be available as part of the machine state to the
  aggregate's command and event handlers, entry and exit actions, invariants,
  and projections derived from that state.
- Projections MAY expose active occurrences, resolved occurrences, or a chosen
  summary, computed from stored state alone. Their definitions MUST select
  what to include; the runtime MUST NOT silently omit resolved occurrences.
- Reading errors outside the aggregate MUST follow ordinary projection access
  and context boundaries. Managers MUST NOT read aggregate storage directly.
- Projections containing error data MAY lag and MUST expose their reflected
  aggregate versions as other projections do (see
  [projections](./aggregates/projections.spec.md#behavior)).
- Error details MUST NOT be included automatically in a controller response.
  Authentication, authorization, and response shapes still govern what is
  exposed. A modeled error in a read result is not automatically an HTTP error
  response (see [controllers](./controllers.spec.md#responses)).

### Reactions and recovery

- A reactor MAY respond to the ordinary aggregate event that raised or resolved
  an error, under its normal capability and repeat rules. No implicit error
  reactor or callback MUST be created.
- An error resolution command MAY also change ordinary fields and enqueue
  messages, provided the one-aggregate, event-emitting, and atomic Save rules
  hold. Resolution MUST NOT implicitly retry the work that failed.
- A failed reaction MUST retain its ordinary reporting and redelivery
  behavior. This chapter MUST NOT cause the runtime to skip an event, advance
  its shard, acknowledge a queue item, or stop retries merely because an error
  occurrence exists.
- If the program records a known unsuccessful business outcome as an error,
  it does so through an explicit command using modeled data. Defects and failed
  service calls remain failures under [services](./services.spec.md#failure);
  they are not silently converted to business outcomes.

## Why this design

- **One consistency boundary.** A separate error store could report a failure
  the aggregate did not save, or lose an error after its aggregate changed.
  Putting occurrences in machine state preserves transactions, versioning, and
  projection rebuilding.
- **Explicit domain decisions.** A timeout does not reveal whether a remote
  effect happened, and a failed Save may have committed. Automatically raising
  an aggregate error would assert a business fact the runtime does not know.
- **Identified, retained occurrences.** A retry refers to the same failed work,
  not a new error. Retaining a resolved occurrence prevents a delayed repeated
  raise from reopening it. A new attempt uses a new identity.
- **Errors do not replace events.** Error actions evolve an ordinary decision;
  they do not introduce a second mutation path or runtime-generated domain
  events. Aggregates and observers still speak the program's vocabulary.

## Open questions

- **Retention and bounds.** Resolved occurrences can accumulate. How to bound,
  archive, or prune them without losing repeat protection, and how late
  deliveries constrain that retention policy.
- **Recovery of operational failures.** How a permanently failed reaction is
  diagnosed, associated with an aggregate if appropriate, and explicitly
  recovered without hiding failures or silently advancing its shard.
- **Presentation.** Localization, user-facing summaries, and error catalogs;
  occurrence details remain domain data rather than preformatted diagnostics.
- **Declaration syntax.** The exact syntax of aggregate-owned error declarations,
  raise and resolve actions, and references to occurrences in expressions.
