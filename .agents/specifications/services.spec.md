# Services

This chapter defines services: the capabilities a program declares and the
implementor provides. It covers declaring a service, the two kinds of operation,
who may call each, the services Coleslaw provides itself, and what happens when
an operation fails. Terms are defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaring a service

- A service declaration MUST name the service and declare its operations.
- An operation MUST have a name unique within its service, a kind, either query
  or effect, a shape for its input, and a shape for its output.
- A declaration MUST NOT name a technology. Which database, broker, or provider
  implements it is the implementor's choice.
- An outcome the domain cares about, such as a declined payment or a missing
  record, MUST be part of the operation's output shape, usually as one of its
  alternatives. It is a result, not a failure.

## Queries and effects

The two kinds separate asking the world from changing it, so that a change to
the world only ever follows a change to the program.

- A query asks: it returns information and MUST NOT change anything the program
  or the world can observe. A query MAY return a different result each time it
  is called; that is variation at the program's edge.
- An effect changes the world outside the program, such as sending an email or
  charging a card.
- Managers and reactors MAY call queries.
- Only reactors MAY call effects. A reactor reacts to events that have already
  been saved, so an effect never happens for a change the program then refuses.
- Nothing else MAY call a service operation: not controllers, consumers, or
  jobs, which go through managers, and not aggregates, projections, monitors,
  expressions, or config.
- A service MUST NOT call back into the program.

## Effects and repeats

Events are delivered to reactors at least once, so a reactor may call the same
effect again for the same event.

- When a reactor calls an effect, the runtime MUST make the event that caused
  the call available to the implementation, identified by its aggregate's kind
  and identity and its version, so an implementation can recognize a repeat.
- An effect's implementation SHOULD give the same result when called again for
  the same event, without repeating the change, for example by passing the
  event's identification to a provider as an idempotency key.

## Implementations

- An implementor MUST be able to provide an implementation of any declared
  service, for any technology, configured from the program's config.
- Which implementation a process uses MUST be chosen by its config, so the same
  program can use, for example, an in-memory implementation locally and a
  database in production.
- A service MUST be constructed only when the selected mode reaches it (see the
  overview's [modes](./overview.spec.md#modes)).
- Values crossing a service boundary MUST match the operation's shapes, in both
  directions. A value that does not is a failure of the call (see
  [failure](#failure)).
- An operation's shapes MAY accept values that are not data, such as a handle
  from a host library (see
  [patterns as types](./patterns-as-types.spec.md#services-are-the-edge)).

## Provided services

A command needs the current time and new identities, and expressions cannot
produce them. Coleslaw provides two services for them, so that they arrive
through the same edge as every other variation.

- **Clock**: a query that returns the current instant, as a date.
- **Identities**: a query that returns a new identity, unique among the
  identities it has returned.
- Every program MAY use the provided services without declaring them.
- The runtime MUST implement both. An implementor MAY replace either, and a
  checker replaces both to vary what they return.
- A program MUST NOT obtain the time or a new identity any other way.

## Failure

An operation fails when it cannot give a result its output shape accepts: the
provider is unreachable, it times out, or a value crossing the boundary does not
match its shape.

- A failed call is not a business outcome. Whatever made the call MUST fail with
  an error naming the service, the operation, and why.
- A manager whose query fails ends as failed (see
  [managers](./managers.spec.md#results)). A reactor whose call fails has not
  handled the event, which is delivered again.
- The runtime MUST NOT retry a failed call by itself. Repeats come from
  redelivery to reactors, which the program is already written to tolerate.

## Open questions

- **Identity format.** What the provided identity service returns: a string in
  one standard format, or a shape the program chooses.
- **Streams and long results.** Whether a query may return a sequence too long
  to hold at once, such as every record in a table, and how a manager consumes
  it.
