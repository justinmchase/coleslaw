# Queues

This chapter defines the program's internal queues: how managers and reactors
send work for consumers to handle, and how the runtime stores, delivers, and
redelivers that work. A queue is not an integration point with another
application; external events reach reactors through event sources (see
[reactors](./reactors.spec.md)). Terms are defined in the
[glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Queues and events

A queue carries work for one consumer. An event is a fact about a change that
every reactor observing it receives. Queues and events have different
guarantees: a queue gives a message to one consumer at a time; an event is
delivered independently to each observing reactor.

- A queue MUST be declared and used only within the program that owns it.
  Another application MUST NOT send to or consume the queue.
- A program MUST NOT use a queue to receive another application's messages.
  Integrations with external systems that offer queues belong in an
  implementation at the technology edge; external events reach reactors through
  an event source (see [reactors](./reactors.spec.md#external-events)).
- A queue MUST be handled by exactly one consumer. Processes running that
  consumer MAY compete for its messages, but two consumer declarations MUST NOT
  consume the same queue.
- A program's own events MUST NOT be put on a queue. They are delivered to
  reactors by the runtime (see [runtime](./runtime.spec.md#delivering-events)).

## Declaring a queue

A queue declaration names the shape of its message and the delivery guarantees
the program relies on; it names no technology.

- A queue declaration MUST name the queue and declare the shape of its message,
  such as `queue InvoiceRequests { message: InvoiceRequest }`.
- A message's shape MUST accept only data, and its object patterns MUST be
  closed (see [patterns as types](./patterns-as-types.spec.md#closed-objects)).
  It MAY have alternatives, one for each kind of message the queue carries.
- A queue declaration MAY declare a [redelivery bound](#redelivery-bound) and
  an [order group](#order-groups).
- A queue MUST be a member of at most one context, and belongs to the default
  context when it is a member of none. It MUST NOT be exported from a context.
  Only managers and internal reactors of its context MAY send to it, and only
  its consumer handles it (see [modules](./modules.spec.md#declaring-a-context)).
- A queue declaration MUST NOT name a technology or declare operations.

## Messages

- A message is data matching its queue's shape.
- The runtime MUST give each delivery the message, the queue, a stable message
  identity, the message's origin, its sent time, its recorded order-group key
  when declared, and its delivery count.
- A manager-enqueued message's origin MUST identify the accepted command by its
  aggregate kind, identity, and ending version, together with the message's
  position in that command's declared messages.
- A reaction-enqueued message's origin MUST identify the triggering event by
  its aggregate kind, identity, and version, together with the reactor's
  context and name, the sending state, and the number of visits to that state
  in the reaction, counting from one.
- A message's identity MUST be derived deterministically from its queue's
  context and name and its origin. It MUST be preserved across relay retries
  and queue redeliveries. Running the same reactor send step again for the same
  event MUST yield the same identity; another reactor or another visit to the
  state MUST yield a different identity.
- Stable identity does not promise that a message is delivered only once.
  Consumers MUST tolerate repeated copies with that identity.
- The sent time MUST come from the clock service (see
  [provided services](./services.spec.md#provided-services)).
- The delivery count MUST be the number of times the current queue item has
  been delivered to its consumer, including this delivery. Separate duplicate
  copies have separate delivery counts.
- A committed message's value, origin, identity, sent time, and order-group key
  MUST remain unchanged across its relay retries and its queue item's
  redeliveries. A repeated reaction may observe different step results and
  submit another copy with the same identity; it MUST NOT rewrite an already
  committed record.

## Sending

Managers and internal reactors MAY send messages through the runtime's durable
outbox. Sending is not a service effect: it creates work inside the program,
not a change to the outside world.

- A message MUST be computed by expressions from the sender's input and
  variables, and MUST match the queue's shape. A mismatch MUST fail the
  sender, naming the queue, the path that failed, and what was expected.
- A manager MAY enqueue messages only with its one aggregate command. The
  runtime MUST write those messages to the outbox atomically with the command's
  accepted state and event records, and only when the command emits at least
  one event. A command accepted with no events MUST enqueue no messages: an
  ignored repeat starts no new work. A rejected or conflicted attempt, or one
  known not to have committed, MUST enqueue nothing.
- A reaction MAY enqueue a message after the event that caused it has been
  saved. The runtime MUST durably record the message before reporting the send
  step as complete. Once recorded, the message MUST remain deliverable even if
  the reaction later fails.
- A failed outbox write MUST fail the manager command or reaction. It MUST NOT
  be reported as a successful send.
- If the runtime cannot learn whether an outbox write committed, it MUST report
  a failure saying that the command's change and messages, or the reaction's
  message, may stand. A committed record MUST remain deliverable even when its
  write was reported as failed (see [runtime](./runtime.spec.md#outcomes)).
- External-event reactors MUST NOT enqueue messages directly. They may invoke
  managers, whose message sends follow the manager rules above (see
  [external events](./reactors.spec.md#external-events)).

## Delivery

- The runtime MUST relay each outbox message to its queue implementation at
  least once. A relay failure MUST leave the message pending for another
  attempt. A queue implementation MAY discard a duplicate with the same
  identity, but consumers MUST NOT rely on exactly-once delivery.
- Each accepted copy of a message is a queue item. A queue implementation MUST
  lease an item to at most one process running its consumer at a time. The
  runtime MUST extend the lease while handling is in progress. Expiry or
  abandonment without a completed disposition MUST make the item available
  again. A failed handling MUST release its lease unless it is dead-lettered
  at the redelivery bound.
- Expiry may happen while the old process is still running, so an old handling
  may overlap a new one. The runtime MUST stop starting new steps when it
  learns its lease is lost, but work already started may have taken effect.
  Lease ownership MUST NOT be treated as an exactly-once guarantee.
- The runtime MUST carry out a disposition only after the consumer's handling
  ends. A lease MUST identify one queue item and one delivery attempt, so items
  sharing a message identity cannot acknowledge each other. A disposition for
  an expired lease MUST NOT change an item that may already be leased to another
  process.
- A message that does not match its queue's shape MUST be dead-lettered before
  the consumer runs, with a reason naming the shape, the failing path, and what
  was expected. A message that matches its shape but not the consumer's guard
  MUST be acknowledged without invoking a manager.
- A dead letter MUST retain the message and its identity with the reason. It
  MUST be reported with the consumer, queue, identity, and reason. That queue
  item MUST NOT be delivered again by Coleslaw; a separately accepted duplicate
  copy with the same message identity may still arrive.
- A disposition is reported as complete only when the queue implementation
  confirms it. Failure or an unknown result MUST be reported with the consumer,
  queue, message identity, and reason. The runtime MUST NOT report
  acknowledgement or dead-lettering as complete when its result is unknown;
  the item may be delivered again if the disposition did not take effect.

### Redelivery bound

- A message whose handling fails MUST be reported with its delivery count and
  failure. It MUST be delivered again until the redelivery bound is reached;
  when it is reached, the message MUST be dead-lettered with the last failure.
- A queue declaration MAY set the redelivery bound as a whole number of at
  least one. It bounds deliveries of one queue item, including the first;
  its delivery count MUST NOT reset after a failed handling or an expired lease.
  A queue with no declared bound MUST use the runtime's default.
- The runtime MUST enforce the bound even if the queue technology has a
  different retry policy. An item arriving beyond the bound MUST be
  dead-lettered without invoking its consumer, with a reason naming its
  delivery count and the exhausted bound.
- An acknowledged or dead-lettered item MUST NOT be delivered again by
  Coleslaw. Separate duplicate copies remain possible. The program MUST NOT
  read dead letters.

## Order groups

A queue's messages have no order unless its declaration names an order group.

- A queue MAY declare an order-group key, computed by an expression from the
  message, such as the customer it concerns. A key expression that fails MUST
  fail the enqueueing operation.
- The key MUST be data, compared by data equality, and MUST be recorded in the
  outbox with the message. Delivery MUST use the recorded key, not recompute it
  with a later version of the program.
- Distinct messages first relayed from the outbox with the same key MUST be
  delivered in outbox commit order. Messages committed together MUST use the
  order in which the sender declared them.
- Queue items in one group MUST be leased one at a time. The next item MUST NOT
  be leased until the previous one is acknowledged or dead-lettered. A failed
  handling keeps its item first in the group.
- A duplicate relay submission may produce another queue item later; it MUST
  retain its recorded identity and group key, but MUST NOT rewind the group
  past items already completed.
- Dead-lettering an item lets its group's next item proceed without it.
  Consumers that rely on group order MUST tolerate that gap and duplicate
  deliveries.
- Messages with different keys MAY be delivered in any order and handled at the
  same time. Without an order group, all messages MAY be handled in any order
  and at the same time.
- A queue implementation MUST declare whether it supports order groups. Startup
  MUST fail with a diagnostic naming the queue and implementation if a mode
  reaches a queue that requires order groups and its implementation does not
  support them.

## Implementations

- Each queue MUST have an implementation chosen by config, following the
  [service implementation](./services.spec.md#implementations) rules. Its
  technology-specific settings MUST be checked only when a selected mode
  reaches that queue.
- A queue implementation MUST accept relayed messages, lease messages to the
  consumer, extend and release leases, carry out acknowledgements and dead
  letters, and return the message record and delivery count.
- A queue implementation MUST be constructed only when the selected mode
  reaches the queue, by sending to it or running its consumer (see
  [modes](./modes.spec.md#what-a-mode-constructs)).
- Coleslaw MUST provide an in-memory queue implementation. A checker MUST be
  able to choose which message is delivered next, when leases expire, and which
  messages are delivered again (see the overview's
  [checkability](./overview.spec.md#checkability)).

## Stopping

- When worker mode stops, a consumer MUST stop taking new messages and finish
  or abandon the handlings it has started, as
  [modes](./modes.spec.md#stopping) describes. An abandoned handling has no
  disposition; its lease ends and the message is delivered again.

## Why this design

- Messages attached to a manager command are prepared before Save and committed
  with it. Sending them after an accepted outcome would lose work if the process
  stopped between the command and send; sending before Save could start work
  for a command that later conflicts.
- Ignored commands enqueue nothing. Accepting a duplicate without new events
  must not create fresh work just because the manager attached messages again.
- Stable identities let downstream aggregates recognize repeats without
  promising exactly-once effects or requiring a permanent deduplication ledger.
- Leases serialize ownership of a queue item, not all effects of a handling.
  Losing a lease cannot recall a command already sent to an aggregate.

## Open questions

- **The redelivery default.** What the runtime's default redelivery bound is,
  and whether config may change a queue's bound.
- **Delay between deliveries.** Whether a failed message is delivered again
  immediately or after a growing delay, and whether that delay is the runtime's
  or the queue implementation's.
- **Lease length.** How long a lease lasts before it expires when it is not
  extended, and whether that is a setting.
- **Messages with no running consumer.** Whether startup or compilation detects
  a queue whose consumer is not run by any mode.
- **Delayed sending.** Whether a message may be enqueued to become visible only
  after a delay, or whether that belongs to the planned `timers` chapter.
