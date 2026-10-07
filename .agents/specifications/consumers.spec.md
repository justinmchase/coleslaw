# Consumers

This chapter defines consumers: how messages from other systems' queues reach
the program in worker mode. It covers declaring a queue and the shape of its
messages, declaring a consumer and binding a message to a manager, the state
machine a consumer's handling runs, how a handling's end acknowledges a message
or sends it to a dead letter, repeats, order, and failure. Terms are defined in
the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Queues and events

A queue is how another system tells the program something: a broker's queue or
topic subscription that other programs write to. The program's own events are
not messages: they reach reactors, directly or through an event source (see
[reactors](./reactors.spec.md)).

- A queue MUST be an integration point with the world outside the program. The
  program's own events MUST reach the program only through reactors, never
  through a queue it consumes.
- Sending a message to another system changes the world outside the program. It
  is an effect of a service, called by a reactor (see
  [services](./services.spec.md#queries-and-effects)), never a queue
  declaration.

## Declaring a queue

A queue declaration says what a queue's messages are, and nothing about the
technology that carries them. It is implemented as a service is.

- A queue declaration MUST name the queue and declare the shape of its message
  bodies, such as `queue PaymentNotices { body: PaymentNotice }`.
- A queue declaration MAY declare a shape for its messages' attributes, the
  named values a technology carries beside the body, such as headers. A queue
  that declares none gives every message an empty object of attributes.
- A body's and an attributes' shape MUST accept only data, and their object
  patterns are closed (see
  [patterns as types](./patterns-as-types.spec.md#closed-objects)). A body shape
  MAY have alternatives, one for each kind of message the queue carries.
- A queue declaration MUST NOT name a technology. Which broker carries it, and
  how a body is decoded from what the broker holds, is its implementation's
  concern.
- A queue declaration holds no state and is not owned, as a service declaration
  is not: contexts MAY use it freely, and a context's body MAY list it so the
  context can export it (see [modules](./modules.spec.md#declaring-a-context)).
- A queue declaration declares no operations. The program never takes a message
  or acknowledges one itself: the runtime does, through the queue's
  implementation, when it runs a consumer.

## Implementations

- A queue's implementations MUST follow the rules for service implementations
  (see [services](./services.spec.md#implementations) and
  [startup](./startup.spec.md#services)): each is a module, imported only by
  modules declaring modes; the config chooses one through a built-in setting
  named after the queue; and its own settings, such as a connection string, are
  under the queue's settings and are checked only when it is chosen.
- An implementation MUST give each message to the runtime with its body, its
  attributes, a message identity, and its delivery count, which together are the
  message's record.
- The message identity MUST be the one the queue's technology gives the message,
  constant across its redeliveries. The delivery count MUST be the number of
  times the message has been delivered to the consumer, including this one.
- An implementation MUST be able to acknowledge a message, so that it is not
  delivered to that consumer again, and to send it to a dead letter, keeping its
  body, its attributes, and the reason (see [dead letters](#dead-letters)).
- A queue MUST be constructed only when the selected mode reaches it, which is
  when the mode runs a consumer of it (see
  [modes](./modes.spec.md#what-a-mode-constructs)).
- A checker replaces a queue's implementation to choose which messages arrive,
  in what order, and which are delivered again (see the overview's
  [checkability](./overview.spec.md#checkability)).

## Declaring a consumer

A consumer is an entry point of worker mode. It handles one queue's messages,
one at a time per order key, until its mode stops.

- A consumer declaration MUST name the consumer and the one queue it consumes.
- A consumer MUST be a member of the context of the managers it invokes, since a
  context's managers are reached only through its own entry points (see
  [modules](./modules.spec.md#the-boundary)).
- A consumer MAY guard messages with a pattern their body and record must match.
  A message that does not match is acknowledged without invoking anything.
- Every message of a queue MUST be delivered to every consumer of it. Two
  consumers of the same queue each receive every message, and acknowledge it,
  independently; an implementation achieves this, for example, with a
  subscription per consumer.
- Processes running the same consumer MUST share its delivery: each message is
  handled by one of them at a time.

## Messages that do not match

A message's body and attributes are input, and are checked against their shapes
before anything else happens.

- A message's body and attributes MUST be matched against the queue's shapes
  before the consumer's guard, and the values the shapes give are the ones the
  consumer receives (see
  [patterns as types](./patterns-as-types.spec.md#the-value-a-shape-gives)).
- A message whose body or attributes do not match MUST be sent to a dead letter,
  with a reason naming the shape, the path within the value to the part that
  failed, and what was expected there (see
  [patterns as types](./patterns-as-types.spec.md#shapes)). It MUST NOT be
  delivered again first, since matching it again gives the same result.
- A message MUST NOT be discarded, acknowledged, or skipped because it did not
  match. A message that leaves its queue unhandled always leaves as a dead
  letter, with its reason.

## Binding a message

A consumer changes and reads the domain only through managers. The common
consumer binds a message to one operation's input, and needs no machine:

- A consumer MAY be declared as one operation of a manager and that operation's
  input, computed by expressions from the message's body and record, such as
  `consumer RecordPayments from PaymentNotices -> Billing.recordPayment({ invoice: body.invoiceId, amount: body.amount })`.
- The operation's result decides what happens to the message, as
  [dispositions](#dispositions) describes.

A consumer that needs more, such as invoking a different operation for each kind
of message, or reading through one operation before invoking another, runs a
state machine.

## Consumer state machines

A consumer's handling of one message runs a state machine that lasts for that
handling and is never stored. Anything that must wait, or remember between
messages, is an aggregate an operation progresses.

- A consumer's state machine MUST have exactly one start state, which receives
  the message's body and record.
- The machine MAY declare variables, set by handlers and read by expressions,
  which last for the handling.
- Each state that is not final MUST perform exactly one step when the machine
  enters it:
  - invoke an operation of a manager (see [managers](./managers.spec.md));
  - or none, to choose the next state from the variables alone.
- A consumer MUST NOT read a projection, call a service, or send a command
  itself. It does each only through an operation (see the overview's
  [dependency rules](./overview.spec.md#dependency-rules)).
- A step's arguments MUST be computed by expressions from the message's body and
  record and the variables.
- A step's result is the operation's result: completed, with its value; refused;
  rejected, with the reason; conflicted; or failed, with the error (see
  [managers](./managers.spec.md#results)).
- A state MUST declare handlers for its step's result: each guarded by a pattern
  the result must match, tried in order, which MAY set variables and MUST choose
  the next state. A result no handler matches MUST fail the handling, naming the
  state and the result.
- A final state MUST give the handling's disposition (see
  [dispositions](#dispositions)): acknowledge, or dead-letter with a reason
  computed by expressions from the message's body and record and the variables.
- Given the same message and the same step results, a consumer's state machine
  MUST take the same path and give the same disposition. Its only variation is
  what its steps return.

## Several operations

- A consumer's state machine MAY invoke several operations, in the order its
  machine performs them. Each operation sends at most one command, which is its
  own transaction: a handling never makes two aggregates one unit of
  consistency.
- A consumer SHOULD invoke at most one operation that sends a command. Work that
  spans aggregates belongs in reactors, reacting to the events that one
  command's aggregate records.

## Dispositions

A handling ends in exactly one disposition, which the runtime carries out
through the queue's implementation:

- **Acknowledged**: the message is handled, and MUST NOT be delivered to that
  consumer again.
- **Dead-lettered**, with a reason: the message cannot be handled, and MUST be
  sent to a dead letter.
- **Failed**, with an error: the handling did not complete, and the message MUST
  be delivered again, until the [redelivery bound](#redelivery-bound).

A consumer's state machine gives its disposition in its final states. A consumer
declared as one operation and its input, without a machine, gives this
disposition for each of the operation's results:

| Result     | Disposition   | Why                                                                                         |
| ---------- | ------------- | ------------------------------------------------------------------------------------------- |
| Completed  | Acknowledged  | The operation did its work.                                                                 |
| Rejected   | Acknowledged  | A rejection is a business outcome, and it is how a repeated message's command usually ends. |
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

## Dead letters

A dead letter is where a message goes when the program will not handle it, so
that nothing a queue delivers disappears silently.

- Dead-lettering a message MUST keep its body and attributes unchanged, its
  message identity, and the reason, where the queue's technology keeps dead
  letters, such as a dead-letter queue.
- A dead-lettered message MUST be reported, naming the consumer, the queue, the
  message identity, and the reason.
- A dead-lettered message MUST NOT be delivered to that consumer again by
  Coleslaw. Whether it is moved back to its queue, inspected, or discarded is
  decided outside the program.
- The program MUST NOT read dead letters. A dead letter is outside the domain,
  as a failed request's log is.

## Repeats

Messages are delivered at least once: a handling that fails is run again from
its start state, a process may stop after a handling's command is saved but
before its message is acknowledged, and many technologies deliver a message more
than once on their own. So every step a handling performs may be performed again
for the same message.

- The runtime MUST NOT promise more than at-least-once delivery, whatever a
  queue's technology offers.
- A consumer MUST give the same disposition when it handles a message again. The
  operations an earlier attempt invoked are invoked again.
- A consumer MUST NOT try to recognize a repeat itself, such as by remembering
  message identities. Whether a repeated command changes anything is its
  aggregate's decision (see
  [managers](./managers.spec.md#invoked-more-than-once)).
- A consumer MAY bind a message's identity, or an identifier the body carries,
  into an operation's input, so the command carries it and the aggregate's state
  machine can recognize a message whose change has already happened.

## Redelivery bound

- A message whose handling fails MUST be reported, naming the consumer, the
  queue, the message identity, the delivery count, and why it failed.
- The runtime MUST NOT retry a handling, or any step of it, by itself. A failed
  handling is run again only when its message is delivered again. The only other
  retries are a command's own, after a conflict (see
  [aggregates](./aggregates.spec.md#concurrency)).
- A queue declaration MAY declare its redelivery bound: the most times a message
  is delivered to a consumer. A queue that declares none has the runtime's
  default.
- When a message's handling fails on the delivery that reaches the bound, the
  message MUST be sent to a dead letter, with the last failure as its reason.
- The runtime MUST enforce the bound from the delivery count the implementation
  gives, whatever bound the queue's technology applies itself.

## Order

A queue's messages come from other systems, which decide the order they are
written in. Coleslaw orders messages as it orders events (see
[reactors](./reactors.spec.md#order)): by a key, and nothing else.

- A queue declaration MAY declare an order key, computed by an expression from a
  message's body and attributes, such as the customer a message concerns.
- Messages with the same order key MUST reach each consumer in the order the
  queue holds them. A consumer MUST complete its handling of one such message,
  with a disposition other than failed, before it receives the next.
- When a handling fails, delivery of that order key to that consumer MUST resume
  from that message: later messages with the same order key wait until it is
  acknowledged or dead-lettered.
- Nothing else is ordered. Messages of a queue with no order key, and messages
  with different order keys, MAY reach a consumer in any order, and MAY be
  handled at the same time. A consumer of such messages MUST be written to
  handle them in either order.
- An implementation MUST declare whether it preserves order by key, such as by a
  broker's partition or message group. A process whose mode runs a consumer of a
  queue that declares an order key, with an implementation that does not
  preserve it, MUST stop at startup with a diagnostic naming the queue and the
  implementation.
- Each consumer's delivery is independent of every other's. One consumer MAY be
  ahead of or behind another; each still receives its messages in this order.

## Stopping

- When worker mode stops, a consumer MUST stop taking new messages, and finish
  or abandon the handlings it has started, as [modes](./modes.spec.md#stopping)
  describes. A message whose handling was abandoned has no disposition, and is
  delivered again.

## Open questions

- **Verifying senders.** Whether checking where a message came from, such as a
  signature, is only the implementation's concern, giving the consumer only
  messages it has verified, or whether a queue declares what verification it
  requires.
- **The redelivery default.** What the runtime's default redelivery bound is,
  and whether config may change a queue's bound, as it may choose its
  implementation.
- **Delay between deliveries.** Whether a failed message is delivered again
  immediately or after a delay that grows, and whether that delay is the
  runtime's, the queue's, or its technology's.
- **Messages in memory.** Whether Coleslaw provides an in-memory implementation
  of every queue, as it does for the services the runtime needs, and how
  messages are put on it when the program runs locally.
- **Bounding a handling.** A consumer's machine may loop. Whether its steps are
  bounded, and how.
- **Queues as services.** Whether a queue is better declared as a kind of
  operation within a service declaration than as a declaration of its own kind.
