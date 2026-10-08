# Reactors

This chapter defines reactors: how the program reacts to its own and other
applications' events. It covers declaring a reactor, the state machine each
reaction runs, the order events arrive in, and what happens when a reaction
fails. Where reactors run is defined in the overview's
[modes](./overview.spec.md#modes). Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaring a reactor

- A reactor declaration MUST name the reactor and declare the events it reacts
  to.
- A reactor MUST declare whether it handles internal events, which name an
  aggregate kind and event, or external events, which name an event from an
  external source. A reactor MUST NOT mix internal and external events.
- A reactor MAY guard an event with a pattern its payload and record must match.
  An event that does not match is handled by doing nothing.
- Every event a reactor reacts to MUST be delivered to it. Two reactors that
  react to the same event each receive it, independently.

## External events

External events are facts another application publishes in its own vocabulary.
An external-event reactor translates those facts into this program's vocabulary
by invoking its managers. Their vocabulary and schema evolve outside this
program, so the translation belongs at the boundary; keeping external reactors
to managers prevents foreign data from directly driving aggregates or effects.

- An external event MUST have a declared name and a shape for its payload. Its
  source implementation MUST deliver the payload with the source identity, an
  event identity stable across redeliveries and unique within that source, and
  a delivery count. Events from different sources MUST NOT share an identity
  merely because the sources use the same event identifier.
- The runtime MUST match an external payload against its declared shape before
  the reactor's guard or any manager invocation. A mismatch MUST fail and be
  reported, naming the source, event identity, shape, failing path, and expected
  value. It MUST NOT be silently acknowledged.
- An external-event reactor MUST invoke managers only. It MUST NOT send
  aggregate commands, read projections, call services, or enqueue messages
  directly. A manager it invokes may use its ordinary capabilities, including
  sending messages atomically with an accepted command (see
  [managers](./managers.spec.md#the-command)).
- A violation of an external-event reactor's capability restrictions MUST be a
  compile error naming the reactor and the disallowed step.
- An external event's source MUST deliver it at least once. A failed reaction
  MUST be run again from its start state with the same source and event
  identities. Two reactors observing that event MUST have independent
  completion; a failure in one MUST NOT mark the other's delivery complete.
- External events MUST be handled in events mode. The source implementation
  MUST preserve any ordering guarantee the external source declares; absent such
  a guarantee, events MAY arrive in any order.
- External events MUST NOT be treated as this program's aggregate events or
  recorded as local aggregate events. Commands sent by invoked managers MUST
  retain their ordinary transaction and outcome rules; completion or failure
  of the external reaction MUST NOT revise an already-finished command outcome.

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
  enters it, subject to the external-event restrictions above:
  - call a query or an effect of a service (see [services](./services.spec.md));
  - read a projection;
  - send a command to an aggregate;
  - invoke an operation of a manager;
  - enqueue a message to a queue (see [queues](./queues.spec.md#sending));
  - or none, to choose the next state from the variables alone.
- A step's arguments MUST be computed by expressions from the event, its record,
  and the variables.
- A manager invocation's result is the manager operation's result (see
  [managers](./managers.spec.md#results)). A message send completes as sent,
  with its identity, only after the outbox write is confirmed; a failed or
  unknown write fails the reaction.
- A state MUST declare handlers for its step's result: each guarded by a pattern
  the result must match, tried in order, which MAY set variables and MUST choose
  the next state. A result no handler matches MUST fail the reaction, naming the
  state and the result.
- Reaching a final state completes the reaction. A reaction gives no result.
- Given the same event, delivery record, and step results, a reaction MUST take
  the same path. External redelivery may change the delivery count as well as
  step results.
- A reaction's reads MUST follow [queries](./queries.spec.md). Full traversal
  depends on its running mode, not on being a reactor: in-process reactions in
  API mode MUST NOT traverse fully, while Events mode supports traversal.
  Synchronous API reactions MUST share the invoking request's read budget;
  independent API reactions MUST still have a finite invocation read budget.

## Commands, messages, and effects

- An internal-event reaction MAY send several commands and call several effects,
  in the order its machine performs them.
- An internal-event reaction MAY invoke managers and enqueue messages as well.
  An external-event reaction is limited to managers, as
  [external events](#external-events) requires.
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

- A repeated reaction MUST start at its start state, not resume after the
  earlier attempt's last step. It MAY receive different query or command
  results, and therefore take a different path; the same event, record, and
  step results MUST still produce the same path.
- A reaction MUST be written to tolerate steps being performed again without
  repeating a business change that has already happened.
- Commands are safe to repeat when the aggregate's state machine ignores or
  rejects a command whose change has already happened. A reaction SHOULD send
  commands its target aggregates handle this way.
- Effects are safe to repeat when their implementations recognize the event that
  caused them (see
  [effects and repeats](./services.spec.md#effects-and-repeats)).
- Message send identities MUST be stable when the same reaction step is
  performed again (see [queues](./queues.spec.md#messages)). Stable identities
  do not guarantee identical payloads when query results change; message
  handlers MUST use a domain identifier or the message identity to make
  repeated work safe.

## Order

Internal events are ordered the way a partitioned log such as Kafka orders them:
by a key that shards them. These aggregate-derived keys and record ordering rules
do not apply to external events; those follow their source's declared ordering
(see [external events](#external-events)).

- Every event MUST have a shard key. By default it is the event's aggregate
  kind, the event's name, and the aggregate's identity, so each kind of event
  from one aggregate is ordered on its own.
- An aggregate MAY declare a shard key for all of its events, and an event
  declaration MAY declare its own, which takes precedence. Either is computed by
  an expression from the event's payload and the rest of its record. A key of
  the aggregate kind and identity alone orders all of an aggregate's events
  together; a key naming the customer an order belongs to orders the events of
  all of that customer's orders (see
  [commands and events](./aggregates/commands-and-events.spec.md#events)).
- Events with the same shard key MUST reach each reactor in the order they were
  recorded. Events of one aggregate are recorded in version order; events of
  different aggregates that share a shard key are recorded in the order their
  commands were saved. A reactor MUST complete its reaction to one such event
  before it receives the next.
- When a reaction fails, delivery of that shard key to that reactor MUST resume
  from that event: later events with the same shard key wait until it completes.
- Nothing else is ordered. Events with different shard keys MAY reach a reactor
  in any order, and MAY be handled at the same time. With the default key, a
  reactor that reacts to two kinds of event from one aggregate MUST be written
  to handle them in either order.
- Each reactor's delivery is independent of every other's. Reactors MAY run in
  different processes, and one MAY be ahead of or behind another; each still
  receives its events in this order.
- An event source used in events mode MUST preserve this order, for example by
  partitioning by shard key, with a consumer group per reactor.

## Failure

A reaction fails when a step fails, when a step's result has no handler, or when
an expression fails.

- A failed reaction MUST be reported, naming the reactor, the event, and why it
  failed.
- The event MUST then be delivered to that reactor again. Commands the failed
  attempt saved and messages it committed stand, and effects it successfully
  called have happened; the next attempt may repeat those steps (see
  [repeats](#repeats)). A failed write or effect call with an unknown result may
  also have taken effect; failure MUST NOT imply that nothing happened.
- A reaction's failure MUST NOT affect other reactors, or the aggregate whose
  event it was.

## Open questions

- **External event declarations.** How a program names and imports another
  application's event source, and how it pins or evolves that event's shape.
- **External ordering.** How an external source declares its ordering
  guarantees, and whether Coleslaw can require an ordering the source does not
  provide.
- **Events that always fail.** A reaction that fails every time holds up every
  later event with its shard key for that reactor. How the runtime notices it,
  how long it keeps trying, and where such an event goes. Modeled aggregate
  errors do not automatically complete or skip it (see
  [errors](./errors.spec.md#reactions-and-recovery)).
- **Bounding a reaction.** A reaction's machine may loop. Whether its steps are
  bounded, and how.
