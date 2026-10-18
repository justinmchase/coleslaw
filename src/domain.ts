export interface PatternExpressionRuntime<P, E> {
  match(
    pattern: P,
    input: unknown,
  ): Promise<{ matched: boolean; value: unknown }>;
  evaluate(expression: E, variables: Record<string, unknown>): Promise<unknown>;
}

export interface DomainEvent {
  name: string;
  payload: unknown;
}

export interface MachineState {
  state: string;
  fields: Record<string, unknown>;
  errors: readonly unknown[];
}

export interface StoredAggregate {
  machine: MachineState;
  version: number;
}

export type SaveResult = "saved" | "conflict" | "unknown";

export interface StateStore {
  load(kind: string, identity: string): Promise<StoredAggregate | undefined>;
  save(
    kind: string,
    identity: string,
    expectedVersion: number,
    state: StoredAggregate,
    events: readonly DomainEvent[],
  ): Promise<SaveResult>;
}

export interface CommandHandler<P, E> {
  command: string;
  guard?: P;
  decision:
    | { kind: "reject"; reason: E }
    | { kind: "emit"; events: readonly { name: string; payload: E }[] };
}

export interface EventHandler<E> {
  event: string;
  set?: Readonly<Record<string, E>>;
  move?: string;
}

export interface AggregateDefinition<P, E> {
  name: string;
  identityField: string;
  fields: Readonly<Record<string, { pattern: P; initial: E }>>;
  commands: Readonly<Record<string, P>>;
  events: Readonly<Record<string, P>>;
  invariants?: readonly P[];
  start: string;
  states: Readonly<
    Record<string, {
      commands: readonly CommandHandler<P, E>[];
      events: readonly EventHandler<E>[];
      entry?: Readonly<Record<string, E>>;
      exit?: Readonly<Record<string, E>>;
    }>
  >;
}

export type CommandOutcome =
  | { kind: "accepted"; events: readonly DomainEvent[]; version: number }
  | { kind: "rejected"; reason: unknown }
  | { kind: "conflicted" }
  | { kind: "failed"; error: string; mayHaveCommitted: boolean };

function isData(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "object") {
    return ["boolean", "number", "bigint", "string"].includes(typeof value);
  }
  if (ancestors.has(value)) return false;
  const path = new Set(ancestors).add(value);
  const primitive = (v: unknown) =>
    v === null ||
    ["undefined", "boolean", "number", "bigint", "string"].includes(typeof v);
  if (value instanceof Date) return true;
  if (Array.isArray(value)) return value.every((v) => isData(v, path));
  if (value instanceof Map) {
    return [...value].every(([k, v]) => primitive(k) && isData(v, path));
  }
  if (value instanceof Set) return [...value].every(primitive);
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every((key) =>
      typeof key === "string" &&
      Object.getOwnPropertyDescriptor(value, key)?.get === undefined &&
      isData(Reflect.get(value, key), path)
    );
}

export class MemoryStateStore implements StateStore {
  private readonly states = new Map<string, StoredAggregate>();
  private readonly outbox = new Map<string, readonly DomainEvent[]>();

  private key(kind: string, identity: string): string {
    return JSON.stringify([kind, identity]);
  }

  load(kind: string, identity: string): Promise<StoredAggregate | undefined> {
    return Promise.resolve(
      structuredClone(this.states.get(this.key(kind, identity))),
    );
  }

  save(
    kind: string,
    identity: string,
    expectedVersion: number,
    state: StoredAggregate,
    events: readonly DomainEvent[],
  ): Promise<SaveResult> {
    const key = this.key(kind, identity);
    if ((this.states.get(key)?.version ?? 0) !== expectedVersion) {
      return Promise.resolve("conflict");
    }
    const copiedState = structuredClone(state);
    const copiedEvents = structuredClone([
      ...(this.outbox.get(key) ?? []),
      ...events,
    ]);
    this.states.set(key, copiedState);
    this.outbox.set(key, copiedEvents);
    return Promise.resolve("saved");
  }

  pendingEvents(kind: string, identity: string): readonly DomainEvent[] {
    return structuredClone(this.outbox.get(this.key(kind, identity)) ?? []);
  }
}

export class CommandRuntime<P, E> {
  constructor(
    private readonly definitions: ReadonlyMap<
      string,
      AggregateDefinition<P, E>
    >,
    private readonly patterns: PatternExpressionRuntime<P, E>,
    private readonly store: StateStore,
    private readonly attempts = 3,
  ) {
    if (!Number.isSafeInteger(attempts) || attempts < 1) {
      throw new Error("commandAttempts must be a positive integer");
    }
    for (const definition of definitions.values()) {
      this.validateDefinition(definition);
    }
  }

  private validateDefinition(d: AggregateDefinition<P, E>): void {
    if (!Object.hasOwn(d.fields, d.identityField)) {
      throw new Error(`${d.name}: identity field is not declared`);
    }
    if (!Object.hasOwn(d.states, d.start)) {
      throw new Error(`${d.name}: start state is not declared`);
    }
    for (const [stateName, state] of Object.entries(d.states)) {
      for (const handler of state.commands) {
        if (!Object.hasOwn(d.commands, handler.command)) {
          throw new Error(`${d.name}.${stateName}: undeclared command`);
        }
        if (handler.decision.kind === "emit") {
          for (const event of handler.decision.events) {
            if (!Object.hasOwn(d.events, event.name)) {
              throw new Error(`${d.name}.${stateName}: undeclared event`);
            }
          }
        }
      }
      for (const handler of state.events) {
        if (!Object.hasOwn(d.events, handler.event)) {
          throw new Error(`${d.name}.${stateName}: undeclared event handler`);
        }
        if (handler.move && !Object.hasOwn(d.states, handler.move)) {
          throw new Error(`${d.name}.${stateName}: undeclared target state`);
        }
      }
      const eventNames = state.events.map((h) => h.event);
      if (new Set(eventNames).size !== eventNames.length) {
        throw new Error(`${d.name}.${stateName}: duplicate event handler`);
      }
      for (
        const action of [
          state.entry,
          state.exit,
          ...state.events.map((h) => h.set),
        ]
      ) {
        for (const field of Object.keys(action ?? {})) {
          if (!Object.hasOwn(d.fields, field)) {
            throw new Error(
              `${d.name}.${stateName}: undeclared field ${field}`,
            );
          }
        }
      }
    }
  }

  private async initial(
    d: AggregateDefinition<P, E>,
  ): Promise<StoredAggregate> {
    const fields: Record<string, unknown> = Object.create(null);
    for (const [name, field] of Object.entries(d.fields)) {
      fields[name] = await this.patterns.evaluate(field.initial, {});
    }
    return { machine: { state: d.start, fields, errors: [] }, version: 0 };
  }

  private async invalid(
    d: AggregateDefinition<P, E>,
    state: StoredAggregate,
  ): Promise<string | undefined> {
    if (
      !Number.isSafeInteger(state.version) || state.version < 0 ||
      !isData(state.machine) ||
      !Object.hasOwn(d.states, state.machine.state) ||
      !Array.isArray(state.machine.errors) || state.machine.errors.length !== 0
    ) {
      return "invalid stored state or unsupported modeled error state";
    }
    if (
      Object.keys(state.machine.fields).some((name) =>
        !Object.hasOwn(d.fields, name)
      )
    ) {
      return "unknown stored field";
    }
    for (const [name, field] of Object.entries(d.fields)) {
      if (
        !(await this.patterns.match(field.pattern, state.machine.fields[name]))
          .matched
      ) {
        return `field ${name} does not match its pattern`;
      }
    }
    for (const pattern of d.invariants ?? []) {
      if (!(await this.patterns.match(pattern, state.machine)).matched) {
        return "aggregate invariant does not match";
      }
    }
  }

  private async set(
    machine: MachineState,
    assignments: Readonly<Record<string, E>> | undefined,
    input: unknown,
  ): Promise<void> {
    for (const [name, expression] of Object.entries(assignments ?? {})) {
      machine.fields[name] = await this.patterns.evaluate(expression, {
        input,
        state: structuredClone(machine),
      });
    }
  }

  async handle(
    kind: string,
    identity: string,
    command: string,
    payload: unknown,
  ): Promise<CommandOutcome> {
    const d = this.definitions.get(kind);
    if (!d) {
      return {
        kind: "failed",
        error: `undeclared aggregate ${kind}`,
        mayHaveCommitted: false,
      };
    }
    let saving = false;
    try {
      for (let attempt = 0; attempt < this.attempts; attempt++) {
        const loaded = await this.store.load(kind, identity);
        const current = loaded ?? await this.initial(d);
        const defect = await this.invalid(d, current);
        if (defect) {
          throw new Error(`${kind} version ${current.version}: ${defect}`);
        }
        if (loaded && loaded.machine.fields[d.identityField] !== identity) {
          throw new Error(
            `${kind} version ${current.version}: stored identity mismatch`,
          );
        }
        const pattern = d.commands[command];
        if (!Object.hasOwn(d.commands, command)) {
          return { kind: "rejected", reason: `undeclared command ${command}` };
        }
        if (!isData(payload)) {
          return {
            kind: "rejected",
            reason: `non-data payload for ${command}`,
          };
        }
        const matched = await this.patterns.match(pattern, payload);
        if (!matched.matched || !isData(matched.value)) {
          return { kind: "rejected", reason: `invalid payload for ${command}` };
        }
        let handler: CommandHandler<P, E> | undefined;
        for (const candidate of d.states[current.machine.state].commands) {
          if (
            candidate.command === command &&
            (candidate.guard === undefined ||
              (await this.patterns.match(candidate.guard, {
                input: matched.value,
                state: current.machine,
              })).matched)
          ) {
            handler = candidate;
            break;
          }
        }
        if (!handler) {
          return {
            kind: "rejected",
            reason: `${command} unhandled in ${current.machine.state}`,
          };
        }
        const variables = {
          input: matched.value,
          state: structuredClone(current.machine),
        };
        if (handler.decision.kind === "reject") {
          const reason = await this.patterns.evaluate(
            handler.decision.reason,
            variables,
          );
          if (!isData(reason)) throw new Error("rejection reason is not data");
          return {
            kind: "rejected",
            reason,
          };
        }
        const events: DomainEvent[] = [];
        for (const event of handler.decision.events) {
          events.push({
            name: event.name,
            payload: await this.patterns.evaluate(event.payload, variables),
          });
        }
        if (events.length === 0) {
          return { kind: "accepted", events, version: current.version };
        }
        const next = structuredClone(current);
        for (const event of events) {
          const eventHandler = d.states[next.machine.state].events.find((h) =>
            h.event === event.name
          );
          if (eventHandler) {
            await this.set(next.machine, eventHandler.set, event.payload);
            if (eventHandler.move) {
              await this.set(
                next.machine,
                d.states[next.machine.state].exit,
                event.payload,
              );
              next.machine.state = eventHandler.move;
              await this.set(
                next.machine,
                d.states[next.machine.state].entry,
                event.payload,
              );
            }
          }
          next.version++;
        }
        for (const event of events) {
          if (
            !isData(event.payload) ||
            !(await this.patterns.match(d.events[event.name], event.payload))
              .matched
          ) {
            return {
              kind: "rejected",
              reason: `invalid event payload for ${event.name}`,
            };
          }
        }
        const invalid = await this.invalid(d, next);
        if (invalid) return { kind: "rejected", reason: invalid };
        if (next.machine.fields[d.identityField] !== identity) {
          return {
            kind: "rejected",
            reason: "aggregate identity cannot change",
          };
        }
        saving = true;
        const result = await this.store.save(
          kind,
          identity,
          current.version,
          next,
          events,
        );
        saving = false;
        if (result === "saved") {
          return { kind: "accepted", events, version: next.version };
        }
        if (result === "unknown") {
          return {
            kind: "failed",
            error: "Save result unknown; aggregate change and events may stand",
            mayHaveCommitted: true,
          };
        }
      }
      return { kind: "conflicted" };
    } catch (error) {
      return {
        kind: "failed",
        error: `${error instanceof Error ? error.message : String(error)}${
          saving
            ? "; Save result unknown; aggregate change and events may stand"
            : ""
        }`,
        mayHaveCommitted: saving,
      };
    }
  }
}
