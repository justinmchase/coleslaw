# Commands and events

This chapter defines an aggregate's commands and events: their declarations,
their payloads, and what the runtime records with each event. Terms are defined
in the [glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Commands

- An aggregate MUST declare each command it accepts, with a name unique among
  its commands and a pattern for its payload.
- A command's name SHOULD be an imperative in the domain's language (for example
  `Submit`, `Cancel`).
- A command MUST name the identity of the aggregate it is for.
- A command whose payload does not match its pattern MUST be rejected before the
  state machine sees it.

### Pattern declarations and bindings

Reusable patterns MUST use Uffda `rule` declarations rather than require a
separate `shape` declaration construct. Their grammar, references, and
projections MUST reuse Uffda components and obey Coleslaw's data and purity
constraints.

```text
rule IncrementMetadata = { reason: string };

command Increment {
    input: { id: string, by: number };
    metadata: IncrementMetadata?;
}
```

- A command declaration MUST define its `input` pattern and MAY define a
  `metadata` pattern. Inline patterns and referenced rules MUST be supported.
- The command is a matching contract, not an event-producing projection. Pure
  normalization within constituent patterns remains governed by
  [patterns as types](../patterns-as-types.spec.md#the-value-a-shape-gives).
- Declared parts MUST be matched before any handler guard or event projection
  executes. Successful matching MUST bind their canonical values as `input` and
  `metadata`; handlers MUST inherit these bindings without redeclaring their
  patterns.
- A failed command-part match MUST reject the command before deciding, with
  diagnostics identifying the part, failing value path, and expected pattern.
  Expression evaluation MUST NOT substitute for input validation.
- `metadata: IncrementMetadata?` MUST allow absent metadata. Absence MUST remain
  an absent value, not an invented metadata object. Member access follows
  [expressions](../expressions.spec.md#member-access).
- Declaring metadata MUST NOT automatically attach it to event payloads or event
  records. An event projection MUST explicitly select what it carries.

## Events

- An aggregate MUST declare each event it emits, with a name unique among its
  events and either a pattern for its payload or a command-derived projected
  pattern as defined below.
- An event's name SHOULD be a past-tense statement of a fact in the domain's
  language (for example `Submitted`, `Cancelled`).
- An emitted standalone event payload MUST match its declared payload pattern;
  otherwise the command that emitted it MUST be rejected. A command-derived
  event MUST instead use its projected value under the following rules.
- An event declaration MAY declare a shard key, computed by an expression from
  the payload and the rest of the record, overriding any the aggregate declares
  for all its events. Without either, an event's shard key is its aggregate
  kind, its name, and its aggregate's identity. The shard key orders the event's
  delivery to reactors (see [reactors](../reactors.spec.md#order)).
- An event, once recorded, MUST NOT change.
- An event is a notice of a change, not the program's record of it: once
  delivered to everything that observes it, it MAY be discarded, and the program
  never reads it again (see
  [events after saving](../aggregates.spec.md#events-after-saving)).

### Command-derived event projections

```text
event Incremented = Increment -> {
    id: input.id,
    by: input.by,
    count: (add state.fields.count input.by),
    reason: metadata.reason
};

start state Ready {
    command Increment {
        emit Incremented;
    }
}
```

- The whole `Increment -> { ... }` pattern MUST define the command-derived
  event's value. The command name MUST resolve to a command of the owning
  aggregate; its matched bindings supply the projection's scope.
- The projection MUST execute only when the handler emits that event, using the
  validated command bindings and decision-time machine state. Declaring an event
  MUST NOT execute its projection or cause implicit emission.
- `emit Incremented;` MUST use the declared projection. A bare emission of an
  event without such a projection, or from a different source command's handler,
  MUST be diagnosed before execution.
- The projected result MUST be the event payload. A second output pattern MUST
  NOT be required, and the result MUST NOT be rematched against the source
  command's input pattern.
- Projected payloads MUST be domain data. Projections MUST be pure and
  deterministic; expression failures and non-data results MUST be surfaced
  explicitly, and MUST prevent saving any state, event, or attached message.
  Pattern normalization MUST NOT be reapplied to the resulting payload during
  evolving or delivery.
- A command MAY have multiple named event projections. A handler MAY emit zero,
  one, or multiple events. Each emitted projection MUST use the same
  decision-time state, not state produced by evolving an earlier event.
- Emission order MUST determine evolution order and event versions. Only after
  deciding produces the complete event sequence MUST evolving begin; each event
  handler then sees the state produced by preceding events.
- The existing atomic save and zero-event rules MUST apply to projected events
  exactly as to standalone events.

## Event records

When the runtime records an event for delivery, it records with it:

- the aggregate's kind and identity;
- the event's name;
- its shard key;
- the event's version: the aggregate's version once the event has been evolved;
- the time the runtime recorded it.

- The recorded time is when the system noticed the event. When the domain needs
  the time something happened in the world, which can differ, that time MUST be
  part of the event's payload, and so arrive in the command.
- Event handlers MAY read the record as well as the payload.

## Open questions

- **Projected event evolution across versions.** How retained projected values
  are checked for compatibility by a changed program without rerunning their
  source commands or projections.
- **Additional command parts.** Whether commands may declare named parts beyond
  `input` and `metadata`, and their invocation envelope syntax.

- **Changing an event's pattern.** Events recorded but not yet delivered when a
  new version of the program starts were written under the old pattern. How a
  reactor or monitor running the new version handles them.
- **Correlation.** Whether event records carry the command that caused them, and
  the request or job that sent that command, for tracing and auditing.
