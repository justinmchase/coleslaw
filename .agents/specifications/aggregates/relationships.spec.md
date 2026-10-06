# Relationships

This chapter defines how aggregates refer to each other, and how an aggregate
holds entities of its own. Terms are defined in the
[glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## References between aggregates

- An aggregate MUST refer to another aggregate only by that aggregate's
  identity, held in a field.
- A reference field MUST name the kind of aggregate it refers to, so that its
  pattern is that kind's identity pattern.
- A reference MAY be to one aggregate, or to a collection of them.
- A reference does not make the two aggregates one unit of consistency. A
  command on one MUST NOT read or change the other.
- The runtime MUST NOT guarantee that a referenced aggregate exists. Whether a
  reference must resolve is a business rule: a manager checks it, through a
  projection, before sending the command, and reacts to events when the
  referenced aggregate changes.

## Entities within an aggregate

- An aggregate MAY hold entities of its own, such as the lines of an order:
  values with an identity that is unique only within the aggregate.
- An entity MUST be part of its aggregate's fields, changed only by the
  aggregate's events, and MUST NOT be referred to from outside the aggregate
  except through the aggregate's identity together with the entity's.

## Why references are by identity

Vernon's rules for aggregates: model true invariants inside a consistency
boundary, keep aggregates small, refer to other aggregates by identity, and use
eventual consistency outside the boundary. An object reference across aggregates
invites changing both in one transaction, which makes the boundary meaningless
and the aggregates large. An identity can only be used to send a command or to
look something up, both of which go through a manager.
