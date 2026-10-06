# Monitors

This chapter defines monitors: state machines that observe events and assert
rules about them, after the P language's `spec` machines. Terms are defined in
the [glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaration

- A monitor MUST declare the events it observes, from one or more aggregate
  kinds, and is otherwise a state machine with fields and event handlers.
- A monitor's event handlers MAY assert: state a pattern the event and the
  monitor's state must match, with a message for when they do not.
- A monitor's state MAY be marked hot: a condition the program must not remain
  in forever, such as an order that was submitted but never fulfilled or
  cancelled.
- A monitor MAY be keyed, like a projection, to watch each aggregate separately.

## Behavior

- Monitors MUST have no effect on the program: they MUST NOT emit events, send
  commands, call services, or change any aggregate or projection.
- A failed assertion MUST be reported, naming the monitor, the event, and the
  message. It MUST NOT undo or block the event, which has already happened.
- A monitor that stays in a hot state longer than its declaration allows MUST be
  reported the same way.

## Open questions

- **Running monitors.** Whether monitors run in production, in tests, or only
  when exploring a program systematically.
- **How long is forever.** How a hot state's allowance is declared: a duration,
  or only at the end of an exploration, as in P.
