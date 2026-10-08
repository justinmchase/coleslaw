# Consumers

This chapter defines consumers: the program's worker-mode entry points for
handling messages from its own queues through managers. It covers declaring a
consumer, binding a message to a manager, and the state machine a handling runs.
Queue declarations, delivery, order, retries, and dead letters are defined in
[queues](./queues.spec.md). Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Consumers and queues

A consumer handles messages from one queue declared by the program. It does not
consume another application's queue, or receive the program's own aggregate
events; those reach reactors (see
[reactors](./reactors.spec.md#declaring-a-reactor)).

- A consumer MUST be an entry point of worker mode.
- A consumer declaration MUST name the consumer and the one queue it consumes.
- Each queue MUST have exactly one consumer declaration. A queue with no
  consumer or more than one consumer MUST be a compile error naming the queue
  and the conflict.
- A consumer MUST be a member of the context of the managers it invokes, since
  a context's managers are reached only through its own entry points (see
  [modules](./modules.spec.md#the-boundary)).
- A consumer MAY guard messages with a pattern the message and record must
  match. A message that does not match the guard MUST be acknowledged without
  invoking a manager.
- Processes running the same consumer MUST share its delivery: a message is
  handled by only one of them at a time.

## Messages that do not match

A message is input and is checked against its queue's shape before anything
else happens.

- A message MUST be matched against the queue's shape before the consumer's
  guard, and the value the shape gives is the one the consumer receives (see
  [patterns as types](./patterns-as-types.spec.md#the-value-a-shape-gives)).
- A message that does not match MUST be dead-lettered, with a reason naming the
  shape, the path within the value to the part that failed, and what was
  expected. It MUST NOT be delivered again first, since matching it again gives
  the same result (see [queues](./queues.spec.md#delivery)).

## Binding a message

A consumer changes and reads the domain only through managers. The common
consumer binds a message to one operation's input and needs no machine:

- A consumer MAY be declared as one operation of a manager and that operation's
  input, computed by expressions from the message and its record, such as
  `consumer RenderInvoice from InvoiceRequests -> Billing.renderInvoice({ invoice: message.invoiceId })`.
- The operation's result determines the message's disposition, as
  [dispositions](#dispositions) describes.

A consumer that needs more, such as invoking a different operation for each
kind of message or reading through one operation before invoking another, runs a
state machine.

## Consumer state machines

A consumer's handling of one message runs a state machine that lasts for that
handling and is never stored. Anything that must wait, or remember between
messages, is an aggregate an operation progresses.

- A consumer's state machine MUST have exactly one start state, which receives
  the message and its record.
- The machine MAY declare variables, set by handlers and read by expressions,
  which last for the handling.
- Each state that is not final MUST perform exactly one step when the machine
  enters it:
  - invoke an operation of a manager (see [managers](./managers.spec.md));
  - or none, to choose the next state from the variables alone.
- A consumer MUST NOT read a projection, call a service, send a command, or send
  a queue message itself. It does each only through a manager (see the
  overview's [dependency rules](./overview.spec.md#dependency-rules)).
- A step's arguments MUST be computed by expressions from the message, its
  record, and the variables.
- A step's result is the operation's result: completed, with its value; refused;
  rejected, with the reason; conflicted; or failed, with the error (see
  [managers](./managers.spec.md#results)).
- A state MUST declare handlers for its step's result: each guarded by a
  pattern the result must match, tried in order, which MAY set variables and
  MUST choose the next state. A result no handler matches MUST fail the
  handling, naming the state and the result.
- A final state MUST give the handling's disposition (see
  [dispositions](#dispositions)): acknowledge, or dead-letter with a reason
  computed by expressions from the message, its record, and the variables.
- Given the same message and the same step results, a consumer's state machine
  MUST take the same path and give the same disposition. Its only variation is
  what its steps return.

## Several operations

- A consumer's state machine MAY invoke several operations, in the order its
  machine performs them. Each operation sends at most one command, which is its
  own transaction: a handling never makes two aggregates one unit of
  consistency.
- A consumer SHOULD invoke at most one operation that sends a command. Work
  that spans aggregates belongs in reactors, reacting to the events one
  command's aggregate records.

## Dispositions

A handling ends in exactly one disposition, which the runtime carries out
through the queue implementation (see [queues](./queues.spec.md#delivery)):

- **Acknowledged**: the message is handled and MUST NOT be delivered again.
- **Dead-lettered**, with a reason: the message cannot be handled and MUST be
  sent to a dead letter.
- **Failed**, with an error: the handling did not complete and the message MUST
  be delivered again, subject to the queue's redelivery bound.

A consumer's state machine gives its disposition in its final states. A
consumer declared as one operation and its input, without a machine, gives this
disposition for each of the operation's results:

| Result     | Disposition   | Why                                                                                         |
| ---------- | ------------- | ------------------------------------------------------------------------------------------- |
| Completed  | Acknowledged  | The operation did its work.                                                                 |
| Rejected   | Acknowledged  | A rejection is a business outcome and is how a repeated message's command usually ends.      |
| Refused    | Dead-lettered | The bound input will not match on any delivery, since binding is deterministic.             |
| Conflicted | Failed        | The aggregate was busy; a later delivery decides against its state as it then is.           |
| Failed     | Failed        | A defect or a failed service call; a later delivery may succeed.                            |

- A machine MAY handle a rejection by choosing a final state that dead-letters
  the message instead, when a rejection means the message was wrong rather than
  repeated.
- A handling MUST fail, whatever its machine says, when a step's result has no
  handler or when an expression fails.
- The runtime MUST carry out a disposition only after the handling has ended,
  never before its last step's result is known. A message acknowledged before
  its command was saved would be lost if the process stopped in between.

## Repeats

Messages are delivered at least once: a handling that fails is run again from
its start state, a process may stop after a command is saved but before its
message is acknowledged, and a queue implementation may redeliver on its own.
So every step a handling performs may be performed again for the same message.

- The runtime MUST NOT promise more than at-least-once delivery, whatever a
  queue implementation offers.
- A consumer MUST give the same disposition when it handles a message again.
  The operations an earlier attempt invoked are invoked again.
- A consumer MUST NOT try to recognize a repeat itself, such as by remembering
  message identities. Whether a repeated command changes anything is its
  aggregate's decision (see
  [managers](./managers.spec.md#invoked-more-than-once)).
- A consumer MAY bind the message's identity, or an identifier in the message,
  into an operation's input, so the command carries it and the aggregate's
  state machine can recognize a message whose change has already happened.

## Stopping

- When worker mode stops, a consumer MUST stop taking new messages and finish
  or abandon the handlings it has started, as
  [modes](./modes.spec.md#stopping) describes. An abandoned handling has no
  disposition; its lease ends and the message is delivered again.
