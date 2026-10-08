# Types

This chapter defines named Types: pattern-backed value contracts with explicit
construction and inspectable storage metadata. It also defines how persisted
fields and aggregate identities use them. Direct patterns remain available for
payloads and other validation shapes; a Type does not replace
[shapes](./patterns-as-types.spec.md#shapes).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaration

The declaration form is:

```text
type Integer {
    pattern SignedInt32;
    store {
        kind: "int";
    }
}
```

- A Type MUST have a name and a Uffda pattern. `SignedInt32` in this example
  denotes a resolved pattern accepting signed 32-bit integers, including zero,
  not an inferred generator. A positive-only Type MUST declare that additional
  restriction rather than imply it through the name `Integer`.
- A Type MAY declare `new` construction and `store` metadata independently.
- Types and their pattern dependencies MUST follow ordinary module visibility
  and import/export rules. A pattern MAY be imported through a published Uffda
  grammar package; this does not load that package as arbitrary host code.
- Declaring a Type MUST NOT execute its pattern or constructor, allocate an
  identity, or access storage.
- Persisted fields, including aggregate identities, MUST resolve to a declared
  Type with a pattern and an inspectable storage contract. A bare pattern or
  named shape alone MUST NOT satisfy a persisted field declaration.
- Relationship identity Types MUST be derived from the target aggregate.
  Persisted projection fields MUST likewise resolve to Types, retaining nominal
  identity distinctions where declared.
- Command and event payloads, route inputs, and other validation shapes MAY use
  patterns directly. Parentheses are not what makes a pattern a pattern.

## Common Types

- Coleslaw SHOULD provide common field Types so routine fields do not require
  application-specific declarations. Candidates include `Integer`, `BigInteger`,
  `Decimal`, `String`, `Boolean`, `UUID`, and `DateTime`.
- Each provided Type MUST define its actual pattern, canonical representation,
  and storage contract. A name alone MUST NOT imply a range, precision, time
  interpretation, default value, or allocation policy.
- Applications MAY declare custom Types for narrower validation or different
  storage representations. Built-in and custom Types MUST follow the same
  validation and storage rules.

## Validation and canonical values

- A Type's pattern MUST follow the scalar matching, data, closed-object, and
  pure projection rules of [patterns as types](./patterns-as-types.spec.md).
- Pattern projections MAY accept different input representations and produce one
  canonical representation. The produced value, not the original input, MUST be
  used for addressing, relationships, and storage.
- Conversion MUST be deterministic and MUST NOT allocate identities or call
  services. Revalidating a canonical value MUST preserve its value and
  representation.
- A Type with storage metadata MUST produce values compatible with that
  descriptor. Successful pattern matching MUST NOT authorize truncation,
  overflow, precision loss, or a different value on readback.
- Two accepted inputs that normalize to the same identity value for the same
  aggregate kind MUST address the same aggregate. Distinct canonical value
  types, such as numeric `42` and string `"42"`, MUST NOT be silently conflated.

## Construction

An optional value constructor is explicit:

```text
type UUID {
    pattern Uuid;
    new (uuid);
}
```

The example presumes explicitly resolved pattern and constructor bindings; it
does not assert that Uffda exports them from any particular package entry.

- `new` MUST produce a value accepted by the Type's pattern and canonical
  representation. A construction failure MUST be reported explicitly.
- Construction MUST be explicitly requested. Using a Type on a field MUST NOT
  implicitly run `new`, and a pattern MUST NOT imply a constructor.
- Nondeterministic or effectful construction MUST run at an explicit creation
  boundary, outside aggregate deciding, evolving, invariants, and projections.
  Dependencies MUST be explicitly bound; a constructor MUST NOT acquire ambient
  service access.
- A generated value used by a retryable aggregate command MUST be supplied
  before deciding and retained unchanged through conflict retries.
- A constructor MUST NOT return an allocation descriptor where a value is
  expected. Repository allocation is an identity policy, not a value instance.

## Storage metadata

- `store` MUST be static, inspectable metadata. Schema inspection MUST NOT
  execute patterns, constructors, or service operations.
- Storage representation MUST be declared explicitly when an adapter needs it;
  an adapter MUST NOT infer column types or allocation from an arbitrary
  pattern.
- A repository adapter MUST validate that it supports the descriptor and map it
  to a concrete physical representation. Unsupported or ambiguous mappings MUST
  be diagnosed before schema creation or persistence.
- An integer descriptor MUST resolve to a defined integral range and compatible
  runtime representation. `number` alone does not establish integrality or
  lossless support for a SQL `BIGINT`.
- Adapter mappings MUST preserve the
  [storage contract](./patterns-as-types.spec.md#storage). Differences between
  adapters MUST NOT silently change the domain contract.
- Field nullability and identity allocation MUST NOT be properties of the
  reusable `store` descriptor. Effective column metadata MUST incorporate those
  properties from the owning declaration.

## Fields and nullability

The field declaration forms include:

```text
field Integer count;
field Integer initialCount = 0;
field nullable Integer previousCount;
```

- Nullability MUST be declared on the field, independently of its Type's storage
  representation. Ordinary value Types MUST have non-null canonical values;
  field-level `nullable` adds `null` to that field's contract.
- A nullable field MUST accept `null` or a valid canonical value of its declared
  Type. A non-nullable field MUST reject `null`, including when its underlying
  pattern would otherwise accept it.
- Nullable MUST NOT mean optional: a present `null` and an omitted creation
  value are distinct. These field rules do not change optional-key matching in
  command payload shapes.
- A field MAY omit an initializer. Creation MUST explicitly supply a value for
  every ordinary field without an initializer, including nullable fields.
  Missing creation values MUST be refused before deciding or persisting.
- An explicit creation value MUST be validated and canonicalized. Otherwise, a
  declared initializer MUST supply the initial value and satisfy the same
  contract. Defaults MUST NOT be invented from a Type, pattern, nullability, or
  storage descriptor.

## Aggregate identities

The identity declaration forms include:

```text
identity Integer id;
identity auto Integer id;
```

- An identity without `auto` MUST be supplied explicitly when addressing or
  creating an aggregate. It MUST have no ordinary field initializer.
- Supplied identities MUST be validated and canonicalized before storage lookup
  or deciding. New aggregate state MUST take its identity from that supplied
  value, not a placeholder default.
- Each aggregate kind MUST have a nominal identity contract derived from its
  declaration. Two aggregate kinds sharing a value Type MUST NOT thereby have
  interchangeable identity contracts.
- Relationships and declared projection fields MUST retain the target
  aggregate's nominal identity contract, even when serialized values have
  identical representations. Raw boundary values MUST be validated in an
  explicitly established target-aggregate context.
- Identity MUST be non-null and immutable once assigned. Pending allocation MUST
  NOT be represented as a valid null, zero, or empty-string identity.
- `auto` MUST request allocation by the configured runtime repository. It MUST
  NOT make other fields, references, or projection values of the same Type
  allocate values.
- Repository allocation MUST distinguish reserving a value before submission
  from assigning a value during insertion. An adapter MUST NOT silently
  substitute one for the other.
- A reserved identity MUST be validated before deciding and retained through
  retries. Allocation MAY leave gaps; `auto` does not promise a gapless
  sequence.
- An insert-generated identity MUST be returned as part of successful creation.
  Creation, final identity, state, events, and attached messages MUST satisfy
  the existing atomic-save contract. An unknown commit MUST NOT cause blind
  reinsertion or report a fabricated identity.
- A repository MUST NOT expose insertion-assigned identities to deterministic
  decisions as though they were already known. Until its creation protocol is
  specified, that allocation mode MUST be diagnosed as unsupported.

## Open questions

- **Creation protocol:** syntax for supplying initial field values and
  requesting Type construction; idempotency, final identity binding in events,
  and outcomes for repository-assigned-at-insert creation.
- **Storage vocabulary:** integer widths, decimal precision and scale, string
  length, and portable versus adapter-specific descriptors.
- **Common Type catalog:** the initial provided set, exact exported names,
  canonical representations, and storage descriptors.
- **General nominal Types:** whether separately named Types with identical
  patterns are nominal beyond aggregate-owned identities, and explicit
  conversion syntax.
- **Constructors:** dependency signatures and capability checking. A `new`
  declaration does not grant unrestricted host code or service access.
- **Conversion syntax:** whether separate parse/format declarations are needed
  beyond pure pattern projections.
