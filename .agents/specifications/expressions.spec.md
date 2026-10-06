# Expressions

This chapter defines Coleslaw's expressions: the language they are written in,
what they may refer to, the core functions they may call, how they compare
values, and what happens when one fails. Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## The expression language

- Coleslaw's expressions MUST be Uffda expressions, written in Uffda's
  expression syntax and evaluated by Uffda's expression runtime.
- A module MAY declare funcs: Uffda func declarations, each a pattern its
  arguments must match and an expression computed from them. Expressions MAY
  call funcs, and MAY create and call lambdas.

## Purity

Expressions compute values. Everything a program does is done by its
declarations: aggregates emit events, and managers and reactors send commands
and call services.

- An expression's value MUST depend only on the names in its scope, and
  evaluating it MUST have no effect.
- An expression MUST NOT call a service, send a command, or emit an event.
  Service operations are not values in any expression's scope.
- An expression MUST NOT read the clock, generate randomness or identities, or
  read the environment. A value that varies must arrive from the program's edges
  (see the overview's [checkability](./overview.spec.md#checkability)).
- Uffda's native expressions, which run host code, MUST NOT be used. A program
  contains no host code; host code lives only in the implementations of
  services.

## Scope

- An expression MUST be able to refer only to:
  - the names its declaration gives it, which each declaration's chapter defines
    (for example, a command handler gives the command and the machine state);
  - variables captured by the patterns of its declaration;
  - the funcs and named shapes the module declares or imports;
  - the core functions.
- A name that refers to none of these MUST be a compile error. Because every
  scope is known when a program is compiled, an unresolved name never reaches
  the runtime.
- Uffda's reserved name `_`, the value a pattern matched, MAY be used in a
  shape's projections. Uffda's reserved name `this`, the parser's match, MUST
  NOT be used: it describes how a value was parsed, not the domain.

## Core functions

The functions every expression may call are the runtime's globals. Coleslaw
provides its own set, rather than inheriting Uffda's.

- Coleslaw MUST define its core functions. It MAY include functions Uffda
  defines, under their Uffda names, when they meet this section's rules.
- Every core function MUST be pure, deterministic, and general purpose.
- A program MUST NOT add core functions. A capability the core functions lack
  comes from a service, or is written as a func.
- The core functions MUST include `eq` and `deep` (see [equality](#equality)).

## Equality

Most comparisons in a program are patterns: a handler's guard, a shape, or an
alternative that matches a literal. Matching a value against a pattern compares
it deeply, part by part, and names what failed when it does not match.

- A comparison SHOULD be written as a pattern wherever a pattern can express it,
  such as a command handler guarded by `{ status: "open" }`. `eq` and `deep` are
  for comparisons a pattern cannot express.
- Uffda's `$name` pattern, which matches a value equal to a value in scope,
  compares by identity, as `eq` does. Matching an object against `$name` bound
  to another object is therefore true only when they are the same object. To
  compare two objects by value, a pattern matches their parts, as
  `{ currency: $currency, amount: $amount }` does against primitives in scope,
  or an expression uses `deep`.
- `(eq x y)` MUST be identity: true when `x` and `y` are the same primitive
  value, as JavaScript's `===` decides, or the same object.
- `(deep x y)` MUST be data equality: true when `x` and `y` are equal as
  [patterns as types](./patterns-as-types.spec.md#equality) defines.
- Because materialized data never shares an object between two places (see
  [patterns as types](./patterns-as-types.spec.md#storage)), `eq` on objects
  depends only on how values flowed through the evaluation, never on how they
  were stored. It is deterministic.

## Values that are not data

- While computing, an expression MAY produce values that are not data, such as a
  lambda, or an iterator over a collection. Only where a value reaches a shape
  must it be data.

## Failure

An expression can fail: a core function given an argument it does not accept, a
func whose argument pattern does not match, or a member read from `undefined`.

- A failed expression is a defect in the program, never a business outcome. It
  MUST NOT be treated as a rejection, or as a failed match of a pattern
  alternative.
- Whatever the expression was part of MUST fail with an error naming the
  expression's location in the source, and nothing it would have changed MUST be
  saved. A command whose handling fails this way ends as failed (see
  [outcomes](./aggregates.spec.md#outcomes)).
- Where a chapter says a computation MUST NOT fail, such as evolving an
  aggregate or computing a projection, a failed expression there is still
  reported this way. The rule says a program must be written so it cannot
  happen, not that the runtime hides it when it does.

## Open questions

- **Termination.** Funcs may call themselves, so an expression may never finish.
  Whether evaluation is bounded, and how the bound is chosen and reported.
- **The catalogue of core functions.** Which functions the core set holds beyond
  `eq` and `deep`, and how a function is added to it.
