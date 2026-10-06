# Projections

This chapter defines projections: read models derived from aggregates' stored
state. Terms are defined in the [glossary](../glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Declaration

- A projection MUST declare the aggregate kinds it derives from, the pattern of
  its value, and how its value is computed, with expressions over the machine
  states and versions of those aggregates.
- A projection MAY be keyed: one value per key, with each aggregate's key
  computed from its state. A projection of one aggregate kind keyed by its
  identity gives one read model per aggregate.

## Behavior

- A projection's value MUST be a pure, deterministic function of the stored
  states it derives from. Computing it MUST NOT fail.
- When an aggregate a projection derives from is saved, the projection MUST be
  brought up to date with the new state.
- A projection's value MUST be reproducible from the stored states alone:
  discarding it and computing it again from the current stored states MUST
  produce the same value. So a projection can be rebuilt at any time, including
  when it is new, when its declaration changes, or when its own storage is lost.
- Projections are eventually consistent: a projection MAY lag behind the states
  it derives from. A reader MUST be able to learn which version of each
  aggregate a projection reflects, so a manager can wait for a command's change
  to appear.
- Projections MUST NOT emit events, send commands, or call services.

## Why state rather than events

Events are discarded once delivered, so a projection built from events could
never be rebuilt: a new projection, or a changed one, would have nothing to
start from. The stored states are kept, so a projection derived from them can
always be computed again.

## Open questions

- **Projections across aggregates.** How a projection that combines many
  aggregates, such as a count or a total, is computed without reading every
  aggregate on each save.
- **Queries.** How managers ask a projection for values: by key only, or by
  patterns over its values, with paging.
- **Rebuilding.** When the runtime rebuilds a projection, and what readers see
  while it does.
