# Patterns as types

This chapter defines how Coleslaw uses Uffda patterns as its types: what a shape
is, the value a shape gives, which values a shape may accept, and how values are
compared and stored. Terms are defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Shapes

A shape is a pattern used as a type. Every place a Coleslaw program describes a
value is a shape: a field, a command's or event's payload, a service operation's
inputs and outputs, the config, a job's arguments, a message body, and a route's
parameters.

- A shape MUST be a Uffda pattern, written in Uffda's pattern syntax.
- A shape MUST be matched against exactly one value, the way Uffda matches a
  scalar input, and MUST consume that value. A pattern that can only succeed by
  consuming more or less than one value never matches.
- A value has a shape when the shape's pattern matches it.
- A value that does not match its shape MUST be refused where it arrives, and
  the refusal MUST name the shape, the path within the value to the part that
  failed, and what was expected there.

## The value a shape gives

- When a shape matches, the value used is the value the pattern produces, not
  necessarily the value that arrived. A pattern that projects a value (with
  `->`) MAY therefore supply a default for a missing value, normalize a value,
  or choose among alternatives (see the overview's principle that patterns may
  choose values).
- A shape's projections MUST be deterministic: the same arriving value MUST
  always give the same value. They are expressions, and expressions are pure.

## Closed objects

Uffda's object pattern checks only the keys it declares and ignores the rest.
For a type that is the wrong default: an undeclared key in a command payload
would be accepted, written into an event, and kept forever.

- An object pattern in a shape MUST fail on a value that has a key it does not
  declare, unless the pattern says what undeclared keys must match.
- A key the pattern declares as optional (for example `{ nickname: string? }`)
  MAY be missing. A missing key and a key whose value is `undefined` MUST be
  treated alike, as Uffda's object pattern treats them.
- This applies to maps matched by an object pattern as well as to objects.

## Data

Fields, payloads, and projections are stored and replayed, so the values they
hold must survive storage unchanged. Data is the set of values that can.

- Data MUST consist of:
  - `undefined`, `null`, booleans, numbers, bigints, and strings;
  - dates;
  - arrays whose elements are data;
  - plain objects whose keys are strings and whose values are data;
  - maps whose keys are primitive data and whose values are data;
  - sets whose members are primitive data.
- Primitive data is `undefined`, `null`, a boolean, a number, a bigint, or a
  string. Map keys and set members are limited to primitive data because
  JavaScript compares any other key by identity, and identity does not survive
  storage.
- Functions, symbols, errors, class instances, promises, and every other value
  not listed MUST NOT be data. Errors are excluded because what they carry, such
  as a stack trace, depends on the host rather than the domain; a domain failure
  is a rejection with a reason, which is data.
- The shape of a field, a command or event payload, a projection, the config, a
  job's arguments, or a message body MUST accept only data. A value that matches
  such a shape's pattern but is not data MUST be refused as though the pattern
  had failed, so `any` in these shapes means any data.
- A shape whose pattern requires a type that is never data (for example the
  `function` or `symbol` type keyword) MUST be a compile error.

## Services are the edge

A service is implemented by the host, so it may need values that are not data: a
connection, a stream, or a handle from a host library.

- A service operation's shapes MAY accept values that are not data.
- A value that is not data MUST NOT reach a field, a payload, a projection, or
  anything else that is stored: the shapes of those places refuse it.

## Storage

- Storing data and reading it back MUST give an equal value of the same type: a
  date reads back as a date, a bigint as a bigint, a map as a map with its
  entries in the same order, and a number exactly, including `NaN`, the
  infinities, and negative zero.
- An object key whose value is `undefined` MAY be dropped when stored, since a
  missing key is treated alike.
- Materialized data MUST be a tree: whenever the runtime gives a program data,
  from storage, from delivery, or from a store kept in memory, no object in it
  is shared between two places. A store kept in memory MUST therefore copy data
  when it saves and when it loads, as one that writes elsewhere does in effect.
  Otherwise whether two values are the same object would depend on the store.
- How data is encoded is the runtime's choice, specified in the runtime chapter.
  An encoding that loses a type, such as writing a map as an array or a bigint
  as a string with nothing to say it was one, does not satisfy this chapter.

## Equality

Value objects are equal when their values are equal, and repeats of an event
must be recognizable, so data has an equality of its own, independent of which
objects hold it.

- Two values of data MUST be equal when they are the same type and:
  - primitives: are the same value, with `NaN` equal to itself;
  - dates: denote the same instant;
  - arrays: have equal elements in the same order;
  - plain objects: have the same keys, ignoring order, with equal values;
  - maps: have the same keys, ignoring order, with equal values;
  - sets: have the same members, ignoring order.
- The runtime MUST use this equality wherever it compares data, such as
  recognizing a repeated event. Expressions compare data this way with `deep`,
  and compare identity with `eq` (see
  [expressions](./expressions.spec.md#equality)).

## Value objects

- A value object MUST be declared as a named shape, and MAY be used anywhere a
  shape is expected, including within other shapes.
- A value object MAY be recursive.
- Value objects are immutable, as all data is: nothing in a program can change a
  value in place. A different value is a new value.

## Open questions

- **Spelling closed objects.** Whether an object pattern in Coleslaw is closed
  unless it says otherwise, or must say so explicitly, given that the same text
  in Uffda means an open pattern.
- **Checking expressions against shapes.** Shapes are checked when values
  arrive. Whether the compiler should also check that an expression can only
  produce values of the shape it is used as, which would find some mistakes
  before a program runs.
- **Parameterized shapes.** Whether a shape may take shapes as parameters (for
  example a non-empty list of some shape), as Uffda rules may take parameters.
