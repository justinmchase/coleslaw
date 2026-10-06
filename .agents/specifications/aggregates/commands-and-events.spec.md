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
- An event, once appended, MUST NOT change.

## Event records

When the runtime appends an event, it records with it:

- the aggregate's kind and identity;
- the event's position in the stream, its version;
- the time the runtime recorded it.

- The recorded time is when the system noticed the event. When the domain needs
  the time something happened in the world, which can differ, that time MUST be
  part of the event's payload, and so arrive in the command.
- Event handlers MAY read the record as well as the payload.

## Open questions

- **Changing an event's pattern.** Streams keep events written under earlier
  patterns. Whether a changed pattern must still match every earlier event, or
  whether old events may be upgraded to a new shape as they are read, and how
  that upgrade is declared.
- **Correlation.** Whether event records carry the command that caused them, and
  the request or job that sent that command, for tracing and auditing.
