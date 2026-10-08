# State machines

This chapter defines an aggregate's state machine: its states, its handlers, and
how it decides commands and evolves on events. Its shape borrows from the P
language's machines; its split into deciding and evolving follows the Decider
pattern. Terms are defined in the [glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Definitions

- **Machine state**: the state the machine is in, the values of the aggregate's
  fields, and its modeled error occurrences (see [errors](../errors.spec.md)).
- **Initial machine state**: the start state, with every field at its initial
  value and no error occurrences.
- **Command handler**: a handler in a state for a command. It decides.
- **Event handler**: a handler in a state for an event. It evolves.
- **Decision**: the result of a command handler: either a rejection with a
  reason, or a sequence of zero or more events.
- **Evolution**: the result of an event handler: the next machine state.

## Axioms

- An aggregate's stored machine state is the truth about it.
- Every change to that state is described by an event, and every event is
  delivered to the parts of the program that observe it.
- A stored state outlives the version of the program that saved it: states saved
  by an earlier version are loaded by later versions.

## Constraints

### Separation

- A command handler MUST NOT change the machine state. It only reads it.
- An event handler MUST NOT emit events or reject. It only produces the next
  machine state.
- Therefore every change to an aggregate passes through an event, and what
  observes its events learns of every change.

### Determinism

- Handlers MUST be pure and deterministic: their only inputs are the machine
  state and the command or event, and the same inputs MUST produce the same
  result.

### Totality of evolving

- Evolving MUST be defined for every event of the aggregate in every state, and
  MUST NOT fail.
- An event for which the current state has no event handler MUST leave the
  machine state unchanged.

### Strictness of deciding

- A command for which the current state has no command handler MUST be rejected,
  with a reason naming the command and the state.

## Mechanism

### States

- A state machine MUST have exactly one start state.
- An aggregate MUST declare its start state inline as
  `start state Ready { ... }`, combining the start marker with the state body.
  Ordinary states use `state Name { ... }`; the start state MAY appear before or
  after ordinary states. The separate `start Ready;` declaration MUST NOT be
  accepted. Missing or multiple start state declarations MUST be diagnosed.
- A state MAY declare an entry action, run when the machine moves into the
  state, and an exit action, run when it moves out of it.
- Entry and exit actions are part of evolving: they MAY set fields, and MUST NOT
  emit events or reject.
- Event handlers and entry and exit actions MAY raise or resolve modeled error
  occurrences under the [errors](../errors.spec.md#deciding-and-evolving) rules.
- A state MAY be declared final. A final state has no command handlers, so every
  command to an aggregate in a final state is rejected.

### Command handlers

- A command handler names a command, and MAY add a pattern the command's
  payload, the machine state, or both must match.
- A state MAY have several handlers for one command. They are tried in order,
  and the first whose pattern matches decides. If none matches, the command is
  rejected.
- A command handler's body MUST be one of: emitting a sequence of events, each
  with a payload computed by expressions from the command and the machine state;
  or rejecting, with a reason computed the same way.
- A state MAY ignore a command: the command is accepted and emits no events.

### Event handlers

- An event handler names an event, and MAY set fields, from expressions over the
  event's payload and the machine state, and MAY move to another state.
- Moving to another state runs the current state's exit action, then sets the
  new state, then runs the new state's entry action, in that order.
- The fields an event handler sets are set before the exit action runs.
- A state MAY ignore an event explicitly, which leaves the machine state
  unchanged, as an unhandled event does. Ignoring makes the intent visible.

### Applying a decision

- The events of one decision are evolved in the order they were emitted, each
  from the machine state the previous one produced.
- The machine state after the last event is the aggregate's new state, which the
  runtime checks against field patterns, modeled error constraints, and
  invariants before saving (see
  [handling a command](../aggregates.spec.md#handling-a-command)).

## Why this design

- **Why deciding cannot change state.** If a command handler changed fields
  directly, that change would not be in any event, and nothing observing the
  aggregate's events would learn of it. Splitting deciding from evolving makes
  "every change is an event" hold by construction.
- **Why evolving cannot fail.** Deciding is where a command is accepted or
  refused, so every refusal is a rejection some handler chose, with its reason.
  If evolving could fail, a command could be refused by a rule no handler
  states. So an event the current state does not handle is a no-op, not an
  error.
- **Why an unhandled command is rejected rather than ignored.** A command is a
  request that the domain may refuse. Silently accepting a command a state was
  never written to handle would hide a missing rule. Ignoring must be stated.
- **Why entry and exit actions cannot emit.** They run while evolving, which
  applies a decision already made. An action that emitted events would be a
  second decision, made outside any command handler.
- **Why there is no `defer`.** P defers events in a machine's queue until a
  later state. An aggregate has no queue: each command is handled at once, as
  one transaction. Waiting for a later state is a manager's concern.

## Open questions

- **Detecting unhandled events.** Whether the compiler should warn when an event
  a command handler can emit is not handled by the states the machine can be in
  when it is applied.
