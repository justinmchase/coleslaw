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

## Events

- An aggregate MUST declare each event it emits, with a name unique among its
  events and a pattern for its payload.
- An event's name SHOULD be a past-tense statement of a fact in the domain's
  language (for example `Submitted`, `Cancelled`).
- An emitted event's payload MUST match its pattern; otherwise the command that
  emitted it MUST be rejected.
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

- **Changing an event's pattern.** Events recorded but not yet delivered when a
  new version of the program starts were written under the old pattern. How a
  reactor or monitor running the new version handles them.
- **Correlation.** Whether event records carry the command that caused them, and
  the request or job that sent that command, for tracing and auditing.
