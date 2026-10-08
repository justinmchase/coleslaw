# Managers

This chapter defines managers: the business operations entry points invoke. It
covers declaring an operation, the state machine an operation runs, the one
command it may send, and the result it gives its entry point. Terms are defined
in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Operations

- A manager declaration MUST name the manager and declare its operations.
- An operation MUST have a name unique within its manager, a shape for its
  input, and a shape for its result.
- An operation's input MUST be matched against its input shape before anything
  else happens. Input that does not match MUST be refused, as the
  [patterns as types](./patterns-as-types.spec.md#shapes) chapter describes, and
  the operation ends as refused.

## What an operation does

The common operation binds its input, chooses the aggregate it concerns, and
sends that aggregate a command. It MAY also enqueue messages with that command
(see [queues](./queues.spec.md#sending)). It needs no machine:

- An operation MAY be declared as the identity of an aggregate and a command,
  each computed by expressions from the input, and a result computed from the
  command's outcome.
- An operation MAY declare messages to enqueue with its command, computed by
  expressions from its input and variables before the command step starts.
  They MUST be attached to the command, not sent in a separate step after its
  outcome. The runtime MUST enqueue them only if the command is accepted and
  emits at least one event, atomically with the command's state and events.

An operation that needs more, such as reading a projection, calling a query, or
choosing between commands, runs a state machine.

## Operation state machines

An operation's state machine lives for one invocation. It is created when the
operation is invoked, and is gone when the operation gives its result. It is
never stored.

- An operation state machine MUST have exactly one start state, which receives
  the operation's input.
- The machine MAY declare variables, set by handlers and read by expressions,
  which last for the invocation.
- Each state that is not final MUST perform exactly one step when the machine
  enters it:
  - call a query of a service (see [services](./services.spec.md));
  - read a projection;
  - send the command (see [the command](#the-command));
  - or none, to choose the next state from the variables alone.
- A step's arguments MUST be computed by expressions from the input and the
  variables.
- A state MUST declare handlers for its step's result: each guarded by a pattern
  the result must match, tried in order, which MAY set variables and MUST choose
  the next state. A result no handler matches MUST end the operation as failed,
  naming the state and the result.
- A final state MUST give the operation's result, computed by expressions from
  the input and the variables.
- Given the same input and the same step results, an operation state machine
  MUST take the same path and give the same result. Its only variation is what
  its steps return.

## The command

One operation changes at most one aggregate. Work across aggregates happens
through reactors reacting to the events the operation's command produces, or
through messages the operation enqueues with that command.

- An operation MUST send at most one command.
- An operation MUST NOT enqueue a message unless it sends a command. Its
  messages MUST be written atomically with that command's accepted change and
  MUST NOT be enqueued when the command is rejected, conflicted, or accepted
  with no events. A failure known not to have committed MUST enqueue nothing;
  an unknown commit result follows [runtime outcomes](./runtime.spec.md#outcomes).
- The compiler MUST reject an operation that declares messages without a
  command or as a separate post-command step.
- An operation MAY enqueue messages only to queues of its own context (see
  [queues](./queues.spec.md#declaring-a-queue)).
- The compiler MUST reject an operation state machine in which any path from the
  start state passes through two states that send a command, or through one such
  state twice.
- An operation MUST NOT call an effect. Changes to the world outside the program
  are made by reactors, after the events that justify them are saved.
- A command's outcome is the step's result: accepted, with the events it emitted
  and the aggregate's new version; rejected, with the reason; conflicted; or
  failed (see [outcomes](./aggregates.spec.md#outcomes)).
- A manager MUST NOT read an aggregate's stored state directly. It reads what it
  needs from projections, and MAY wait until a projection reflects the version
  its command produced.
- Projection reads and collection-returning service queries MUST follow
  [queries](./queries.spec.md). A manager MUST inherit the selected mode's
  traversal capability and any invoking Web request's shared read-step budget;
  entering another operation MUST NOT reset that budget.

## Results

An operation ends in exactly one of these, which its entry point turns into its
own response, such as an HTTP status:

- **Completed**, with a value matching the operation's result shape.
- **Refused**: the input did not match the input shape.
- **Rejected**, with the reason: the command was rejected, and no handler chose
  to complete instead. A rejection is a normal business outcome.
- **Conflicted**: the command conflicted, and no handler chose otherwise.
- **Failed**, with an error: the operation met a defect or a failed service
  call. Its command's change and messages may stand if it was accepted before
  the failure or if the runtime could not learn whether Save committed.

- A result value that does not match the result shape MUST end the operation as
  failed.
- When an operation's command is accepted and the operation then fails, the
  command's change and its atomically enqueued messages stand. The failure MUST
  say so.
- An operation MUST preserve a command failure's warning that its change and
  messages may stand; it MUST NOT turn an unknown commit result into a claim
  that nothing was saved.

## Invoked more than once

Some entry points deliver at least once, such as consumers and reactors, so an
operation may be invoked again with the same input.

- An operation MUST NOT try to recognize a repeat itself. Whether a repeated
  command changes anything is the aggregate's decision, made by its state
  machine: a command whose change has already happened is ignored or rejected by
  the state the aggregate is now in.
- An ignored or rejected repeated command MUST enqueue no new messages.

## Open questions

- **Bounding a machine.** An operation state machine may loop, for example
  reading pages of a projection. Read steps in Web mode are bounded by
  [queries](./queries.spec.md#mode-capability); how other steps and loops are
  bounded remains open.
- **Waiting for projections.** How long an operation waits for a projection to
  reflect its command, and what it gives when the wait ends first.
