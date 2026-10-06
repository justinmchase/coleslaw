# Reactors

This chapter defines reactors: how the program reacts to events by sending
commands and changing the world. It covers declaring a reactor, the state
machine each reaction runs, the order events arrive in, and what happens when a
reaction fails. Where reactors run is defined in the overview's
[modes](./overview.spec.md#modes). Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaring a reactor

- A reactor declaration MUST name the reactor and declare the events it reacts
  to, each named by its aggregate kind and event.
- A reactor MAY guard an event with a pattern its payload and record must match.
  An event that does not match is handled by doing nothing.
- Every event a reactor reacts to MUST be delivered to it. Two reactors that
  react to the same event each receive it, independently.

## Reactions

A reaction is one reactor handling one event. Like a manager's operation, it
runs a state machine that lasts only for the reaction and is never stored.
Anything that must wait, or remember between events, is an aggregate the
reaction progresses.

- A reaction's state machine MUST have exactly one start state, which receives
  the event and its record.
- The machine MAY declare variables, set by handlers and read by expressions,
  which last for the reaction.
- Each state that is not final MUST perform exactly one step when the machine
  enters it:
  - call a query or an effect of a service (see [services](./services.spec.md));
  - read a projection;
  - send a command to an aggregate;
  - or none, to choose the next state from the variables alone.
- A step's arguments MUST be computed by expressions from the event, its record,
  and the variables.
- A state MUST declare handlers for its step's result: each guarded by a pattern
  the result must match, tried in order, which MAY set variables and MUST choose
  the next state. A result no handler matches MUST fail the reaction, naming the
  state and the result.
- Reaching a final state completes the reaction. A reaction gives no result.
- Given the same event and the same step results, a reaction MUST take the same
  path. Its only variation is what its steps return.

## Commands and effects

- A reaction MAY send several commands and call several effects, in the order
  its machine performs them.
- Each command a reaction sends MUST be handled as its own transaction (see
  [handling a command](./aggregates.spec.md#handling-a-command)). A reaction
  never makes two aggregates one unit of consistency.
- A command's outcome is the step's result. A rejection is an ordinary result a
  handler may expect, such as a command that is ignored because the aggregate
  has already moved on.

## Repeats

Events are delivered at least once, and a reaction that fails is run again from
its start state. So every step a reaction performs may be performed again for
the same event.

- A reaction MUST give the same outcome when run again for the same event. The
  steps already performed in an earlier attempt are performed again.
- Commands are safe to repeat when the aggregate's state machine ignores or
  rejects a command whose change has already happened. A reaction SHOULD send
  commands its target aggregates handle this way.
- Effects are safe to repeat when their implementations recognize the event that
  caused them (see
  [effects and repeats](./services.spec.md#effects-and-repeats)).

## Order

Events are ordered the way a partitioned log such as Kafka orders them: by kind,
and within a kind by a key that shards them.

- Every event MUST have a shard key. By default it is the event's aggregate's
  kind and identity.
- An event declaration MAY declare its own shard key instead, computed by an
  expression from the event's payload and record, such as the customer an order
  belongs to (see
  [commands and events](./aggregates/commands-and-events.spec.md#events)).
- Events of one kind with the same shard key MUST reach each reactor in the
  order they were recorded. Events of one aggregate are recorded in version
  order; events of different aggregates that share a shard key are recorded in
  the order their commands were saved. A reactor MUST complete its reaction to
  one such event before it receives the next.
- When a reaction fails, delivery of that kind and shard key to that reactor
  MUST resume from that event: later events of the same kind and shard key wait
  until it completes.
- Nothing else is ordered. Events of different kinds, even from the same
  aggregate, and events with different shard keys MAY reach a reactor in any
  order, and MAY be handled at the same time. A reactor that reacts to two kinds
  of event from one aggregate MUST be written to handle them in either order.
- Each reactor's delivery is independent of every other's. Reactors MAY run in
  different processes, and one MAY be ahead of or behind another; each still
  receives its events in this order.
- An event source used in events mode MUST preserve this order, for example with
  a topic per event kind, partitioned by shard key, and a consumer group per
  reactor.

## Failure

A reaction fails when a step fails, when a step's result has no handler, or when
an expression fails.

- A failed reaction MUST be reported, naming the reactor, the event, and why it
  failed.
- The event MUST then be delivered to that reactor again. Commands the failed
  attempt sent stand, and effects it called have happened; the next attempt
  repeats them (see [repeats](#repeats)).
- A reaction's failure MUST NOT affect other reactors, or the aggregate whose
  event it was.

## Open questions

- **Events that always fail.** A reaction that fails every time holds up every
  later event of its kind and shard key for that reactor. How the runtime
  notices it, how long it keeps trying, and where such an event goes.
- **Bounding a reaction.** A reaction's machine may loop. Whether its steps are
  bounded, and how.
