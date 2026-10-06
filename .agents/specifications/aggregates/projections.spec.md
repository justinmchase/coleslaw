# Projections

This chapter defines projections: read models built from events. Terms are
defined in the [glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaration

- A projection MUST declare the events it observes, from one or more aggregate
  kinds, the pattern of its value, and its initial value.
- A projection MUST declare how each observed event changes its value, with
  expressions over the event, its record, and the current value.
- A projection MAY be keyed: one value per key, with each event's key computed
  from the event. A projection of one aggregate kind keyed by its identity gives
  one read model per aggregate.

## Behavior

- Applying an event to a projection MUST be pure and deterministic, and MUST NOT
  fail, for the same reasons evolving an aggregate must not (see
  [state machines](./state-machines.spec.md#why-this-design)).
- A projection MUST apply the events of each stream in that stream's order.
- A projection's value MUST be reproducible from the events alone: discarding it
  and applying every observed event again MUST produce the same value.
- Projections are eventually consistent: a projection MAY lag behind the streams
  it observes. A reader MUST be able to learn how far a projection has applied
  each stream, so a manager can wait for a command's events to appear.
- Projections MUST NOT emit events, send commands, or call services.

## Open questions

- **Order across streams.** Whether a projection observing several streams sees
  their events in one global order, or only each stream's own order.
- **Queries.** How managers ask a projection for values: by key only, or by
  patterns over its values, with paging.
- **Rebuilding.** When the runtime rebuilds a projection, for example after its
  declaration changes, and what readers see while it does.
