# Fields

This chapter defines an aggregate's fields and invariants. Terms are defined in
the [glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Fields

- A field MUST have a name, unique within its aggregate, and a declared Type
  providing its value pattern and inspectable storage contract. A bare pattern
  or named shape alone MUST NOT be used as a persisted field Type.
- Nullability MUST belong to the field, not the Type's storage descriptor (see
  [Types](../types.spec.md#fields-and-nullability)).
- An ordinary field's initial value MUST be explicitly supplied at creation or
  given by its declared initializer. A field without an initializer MUST receive
  an explicit creation value; a pattern or nullable field MUST NOT imply a
  default.
- The identity is a distinguished field with its aggregate kind's nominal
  identity contract. It MUST be supplied or explicitly repository-allocated
  under [Types](../types.spec.md#aggregate-identities), MUST NOT have an
  ordinary field initializer, and MUST NOT change once assigned.
- After initialization, ordinary fields MUST be set only by event handlers and
  by entry and exit actions (see [state machines](./state-machines.spec.md)).

## Invariants

- An aggregate MAY declare invariants: rules about its fields that must hold in
  every state, written as patterns the machine state must match.
- An invariant MAY be declared for one state only, holding while the machine is
  in that state.
- After a decision's events are evolved, every field MUST match its pattern and
  every applicable invariant MUST hold. Otherwise the command MUST be rejected,
  with a reason naming what failed, and nothing saved.
- Invariants MAY inspect modeled error occurrences as part of machine state.
  Occurrences MUST also satisfy their declared identity and details shapes (see
  [errors](../errors.spec.md#deciding-and-evolving)).
- When a stored state is loaded, a field that fails its pattern, an error
  occurrence that fails its constraints, or an invariant that fails is not a
  rejection: the state was accepted when it was saved, so the failure means the
  program changed in a way its existing states do not satisfy. The runtime MUST
  report it as an error naming the aggregate, its version, and what failed, and
  MUST NOT handle the command.

## Why invariants are checked after evolving

A rule that holds after every accepted command is the definition of an
invariant. Checking the state the events produce, rather than trusting each
handler to check its own preconditions, means a handler cannot forget a rule,
and a new handler cannot break one.
