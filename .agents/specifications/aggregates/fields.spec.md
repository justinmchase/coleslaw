# Fields

This chapter defines an aggregate's fields and invariants. Terms are defined in
the [glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Fields

- A field MUST have a name, unique within its aggregate, and a pattern its value
  must match.
- A field MUST have an initial value, given in its declaration or implied by its
  pattern allowing the absence of a value.
- The identity is a field. Its value MUST be set by the event that creates the
  aggregate, and MUST NOT change afterwards.
- Fields MUST be set only by event handlers and by entry and exit actions (see
  [state machines](./state-machines.spec.md)).

## Invariants

- An aggregate MAY declare invariants: rules about its fields that must hold in
  every state, written as patterns the machine state must match.
- An invariant MAY be declared for one state only, holding while the machine is
  in that state.
- After a decision's events are evolved, every field MUST match its pattern and
  every applicable invariant MUST hold. Otherwise the command MUST be rejected,
  with a reason naming what failed, and nothing saved.
- When a stored state is loaded, a field that fails its pattern or an invariant
  that fails is not a rejection: the state was accepted when it was saved, so
  the failure means the program changed in a way its existing states do not
  satisfy. The runtime MUST report it as an error naming the aggregate, its
  version, and what failed, and MUST NOT handle the command.

## Why invariants are checked after evolving

A rule that holds after every accepted command is the definition of an
invariant. Checking the state the events produce, rather than trusting each
handler to check its own preconditions, means a handler cannot forget a rule,
and a new handler cannot break one.
