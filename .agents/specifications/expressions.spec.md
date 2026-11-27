# Expressions

This chapter defines Coleslaw's expressions: the language they are written in,
what they may refer to, the Uffda expression globals they may call, how they
compare values, and what happens when one fails. Terms are defined in the
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
declarations: aggregates emit events; managers and internal-event reactors send
commands and enqueue messages; and managers and reactors call services.

- An expression's value MUST depend only on the names in its scope, and
  evaluating it MUST have no effect.
- An expression MUST NOT call a service, send a command or message, or emit an
  event. Service operations are not values in any expression's scope.
- An expression MUST NOT read the clock, generate randomness or identities, or
  read the environment. A value that varies must arrive from the program's edges
  (see the overview's [checkability](./overview.spec.md#checkability)).
- Uffda's native expressions, which run host code, MUST NOT be used. A program
  contains no host-written domain logic; host code lives in service
  implementations and explicitly declared runtime/infrastructure adapters (see
  [application shell](./application-shell.spec.md#host-boundary)).

## Scope

- An expression MUST be able to refer only to:
  - the names its declaration gives it, which each declaration's chapter defines
    (for example, a command handler gives the command and the machine state);
  - variables captured by the patterns of its declaration;
  - the funcs and reusable pattern rules the module declares or imports;
  - Uffda's expression globals.
- A name that refers to none of these MUST be a compile error. Because every
  scope is known when a program is compiled, an unresolved name never reaches
  the runtime.
- Uffda's reserved name `_`, the value a pattern matched, MAY be used in a
  shape's projections. Uffda's parser-match `this` MUST NOT be exposed: it
  describes how a value was parsed, not the domain.
- In a context-owned mode's composition and entry-point selection, Coleslaw
  `this` MUST refer to the bound context instance under
  [modes](./modes.spec.md#declaring-modes). This capability binding MUST NOT
  expose parser internals or become domain data usable in payload projections.

## Expression globals

The functions every expression may call are Uffda's expression globals.
Coleslaw does not define a private core library and does not ship a private
evaluator.

- Coleslaw MUST evaluate expressions with `uffda-runtime`. It MUST NOT define
  its own function catalogue, and it MUST NOT add a second `deep`.
- Every expression global MUST be pure, deterministic, and general purpose.
  The globals a program may call include `eq`, `add`, `sub`, `length`,
  `when`, and `not`. `eq` is strict equality.
- A program MUST NOT add expression globals. A capability those globals lack
  comes from a Kith child, or is written as a func.
- `(deep x y)` is data equality (see [equality](#equality)). It is an Uffda
  global. Until Uffda provides `deep`, Coleslaw MUST NOT substitute one.
- Random draws and new identities are not expression globals. `(rand Lo Hi)`
  and `Crypto` are Kith. The seeded `Random` component and the `id` function
  are Kith's to add. An expression MUST NOT draw a random value or mint an
  identity.

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
- `(eq x y)` MUST be strict equality, the same decision Uffda's `eq` makes:
  true when `x` and `y` are the same primitive value or the same object.
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

## Member access

- Ordinary member access MUST propagate absence: reading a member of `null` or
  `undefined`, or a missing member, MUST produce `undefined`. Chained reads MUST
  follow the same rule without requiring optional-access punctuation.
- This rule MUST NOT make an unresolved root name valid or suppress other
  expression failures. Names remain subject to compile-time scope checks.
- Patterns MUST determine where an absent result is permitted. Passing it to a
  function or boundary requiring a present value MUST still fail the applicable
  contract; access MUST NOT invent defaults.
- Coleslaw MUST use Uffda expression evaluation for this behavior. If a released
  Uffda runtime does not provide these semantics, that capability MUST be
  implemented upstream rather than through a private expression interpreter.

## Failure

An expression can fail: an expression global given an argument it does not
accept, or a func whose argument pattern does not match. Missing members themselves
propagate absence under [member access](#member-access).

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

- **Released-runtime support.** Uffda 0.9.2's member evaluator directly indexes
  the receiver, so access through `null` or `undefined` does not yet implement
  the [member access](#member-access) contract. An upstream change and released
  dependency are required before Coleslaw can claim this behavior is executable.

- **Termination.** Funcs may call themselves, so an expression may never finish.
  Whether evaluation is bounded, and how the bound is chosen and reported.
- **`deep`.** Uffda does not yet provide the data-equality global. Coleslaw
  waits for that global and does not add a private one.
