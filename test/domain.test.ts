import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  type AggregateDefinition,
  CommandRuntime,
  MemoryStateStore,
  type PatternExpressionRuntime,
  type SaveResult,
  type StateStore,
} from "../src/domain.ts";

type Pattern = "identity" | "number" | "payload" | "any" | "positive";
type Expression =
  | { literal: unknown }
  | { input: string }
  | { field: string; add: number };

const evaluation: PatternExpressionRuntime<Pattern, Expression> = {
  match(pattern, input) {
    const matched = pattern === "any" ||
      (pattern === "identity" &&
        (input === undefined || typeof input === "string")) ||
      (pattern === "number" && typeof input === "number") ||
      (pattern === "payload" && typeof input === "object" && input !== null &&
        "id" in input && typeof input.id === "string") ||
      (pattern === "positive" && typeof input === "object" && input !== null &&
        "fields" in input && typeof input.fields === "object" &&
        input.fields !== null && "count" in input.fields &&
        typeof input.fields.count === "number" && input.fields.count >= 0);
    return Promise.resolve({ matched, value: input });
  },
  evaluate(expression, variables) {
    if ("literal" in expression) return Promise.resolve(expression.literal);
    if ("input" in expression) {
      const input = variables.input;
      if (typeof input !== "object" || input === null) {
        throw new Error("expression input is not an object");
      }
      return Promise.resolve(Reflect.get(input, expression.input));
    }
    const state = variables.state;
    if (typeof state !== "object" || state === null || !("fields" in state)) {
      throw new Error("expression state missing");
    }
    const fields = state.fields;
    if (typeof fields !== "object" || fields === null) {
      throw new Error("expression fields missing");
    }
    const value = Reflect.get(fields, expression.field);
    if (typeof value !== "number") {
      throw new Error("expression field not numeric");
    }
    return Promise.resolve(value + expression.add);
  },
};

function definition(): AggregateDefinition<Pattern, Expression> {
  return {
    name: "Counter",
    identityField: "id",
    fields: {
      id: { pattern: "identity", initial: { literal: undefined } },
      count: { pattern: "number", initial: { literal: 0 } },
    },
    commands: { Increment: "payload", Ignore: "any", Reject: "any" },
    events: { Incremented: "payload", Unhandled: "any" },
    invariants: ["positive"],
    start: "Ready",
    states: {
      Ready: {
        commands: [
          {
            command: "Increment",
            decision: {
              kind: "emit",
              events: [{ name: "Incremented", payload: { input: "self" } }],
            },
          },
          { command: "Ignore", decision: { kind: "emit", events: [] } },
          {
            command: "Reject",
            decision: { kind: "reject", reason: { literal: "not allowed" } },
          },
        ],
        events: [{
          event: "Incremented",
          set: {
            id: { input: "id" },
            count: { field: "count", add: 1 },
          },
        }],
      },
    },
  };
}

function runtime(
  store: StateStore,
  d = definition(),
  attempts?: number,
): CommandRuntime<Pattern, Expression> {
  return new CommandRuntime(
    new Map([["Counter", d]]),
    evaluation,
    store,
    attempts,
  );
}

function payload(id = "one") {
  return { id, self: { id } };
}

Deno.test("req:application-shell-009 - events evolve and save state and version", async () => {
  const store = new MemoryStateStore();
  const r = runtime(store);
  assertEquals(
    (await r.handle("Counter", "one", "Increment", payload())).kind,
    "accepted",
  );
  assertEquals((await store.load("Counter", "one"))?.machine.fields, {
    id: "one",
    count: 1,
  });
  assertEquals(
    (await r.handle("Counter", "one", "Increment", payload())).kind,
    "accepted",
  );
  assertEquals((await store.load("Counter", "one"))?.version, 2);
  assertEquals(store.pendingEvents("Counter", "one").length, 2);
});

Deno.test("req:application-shell-009 - memory storage isolates copies", async () => {
  const store = new MemoryStateStore();
  await runtime(store).handle("Counter", "one", "Increment", payload());
  const loaded = await store.load("Counter", "one");
  if (!loaded) throw new Error("missing test state");
  loaded.machine.fields.count = 100;
  assertEquals((await store.load("Counter", "one"))?.machine.fields.count, 1);
});

Deno.test("req:application-shell-009 - zero-event acceptance never saves", async () => {
  const store = new MemoryStateStore();
  let saves = 0;
  const r = runtime({
    load: store.load.bind(store),
    save: () => {
      saves++;
      return Promise.resolve("conflict");
    },
  });
  assertEquals(await r.handle("Counter", "one", "Ignore", null), {
    kind: "accepted",
    events: [],
    version: 0,
  });
  assertEquals(saves, 0);
  assertEquals(await store.load("Counter", "one"), undefined);
});

Deno.test("req:application-shell-009 - explicit and unhandled rejection saves nothing", async () => {
  const store = new MemoryStateStore();
  const r = runtime(store);
  assertEquals(await r.handle("Counter", "one", "Reject", null), {
    kind: "rejected",
    reason: "not allowed",
  });
  assertEquals(
    (await r.handle("Counter", "one", "Missing", null)).kind,
    "rejected",
  );
  assertEquals(await store.load("Counter", "one"), undefined);
});

Deno.test("req:application-shell-009 - invariant rejection leaves no events", async () => {
  const d = definition();
  d.states.Ready.events[0].set = {
    id: { input: "id" },
    count: { literal: -1 },
  };
  const store = new MemoryStateStore();
  assertEquals(
    (await runtime(store, d).handle("Counter", "one", "Increment", payload()))
      .kind,
    "rejected",
  );
  assertEquals(await store.load("Counter", "one"), undefined);
  assertEquals(store.pendingEvents("Counter", "one"), []);
});

Deno.test("req:application-shell-009 - conflicts retry whole cycle and exhaust bounded attempts", async () => {
  const store = new MemoryStateStore();
  let loads = 0;
  const r = runtime({
    load: (...args) => {
      loads++;
      return store.load(...args);
    },
    save: () => Promise.resolve("conflict"),
  });
  assertEquals(await r.handle("Counter", "one", "Increment", payload()), {
    kind: "conflicted",
  });
  assertEquals(loads, 3);
});

Deno.test("req:application-shell-009 - conflict retry reloads changed state", async () => {
  const store = new MemoryStateStore();
  let first = true;
  const r = runtime({
    load: store.load.bind(store),
    save: async (...args): Promise<SaveResult> => {
      if (first) {
        first = false;
        await runtime(store).handle("Counter", "one", "Increment", payload());
        return "conflict";
      }
      return await store.save(...args);
    },
  });
  const result = await r.handle("Counter", "one", "Increment", payload());
  assertEquals(result.kind, "accepted");
  assertEquals((await store.load("Counter", "one"))?.machine.fields.count, 2);
});

Deno.test("req:application-shell-009 - unknown Save warns without retry", async () => {
  const store = new MemoryStateStore();
  let saves = 0;
  const result = await runtime({
    load: store.load.bind(store),
    save: () => {
      saves++;
      return Promise.resolve("unknown");
    },
  }).handle("Counter", "one", "Increment", payload());
  assertEquals(result.kind, "failed");
  if (result.kind !== "failed") throw new Error("expected failure");
  assertEquals(result.mayHaveCommitted, true);
  assertEquals(saves, 1);
});

Deno.test("req:application-shell-009 - invalid stored state is failed, not rejected", async () => {
  const store = new MemoryStateStore();
  await store.save("Counter", "one", 0, {
    version: 1,
    machine: {
      state: "Ready",
      fields: { id: "one", count: "bad" },
      errors: [],
    },
  }, []);
  assertEquals(
    (await runtime(store).handle("Counter", "one", "Increment", payload()))
      .kind,
    "failed",
  );
});

Deno.test("req:application-shell-009 - definition and retry bound validated", () => {
  assertThrows(() => runtime(new MemoryStateStore(), definition(), 0));
  const d = definition();
  d.identityField = "missing";
  assertThrows(() => runtime(new MemoryStateStore(), d));
});

Deno.test("req:application-shell-009 - storage exception is explicit failure", async () => {
  const r = runtime({
    load: () => Promise.reject(new Error("storage unavailable")),
    save: () => Promise.resolve("saved"),
  });
  const result = await r.handle("Counter", "one", "Increment", payload());
  assertEquals(result.kind, "failed");
  if (result.kind !== "failed") throw new Error("expected failure");
  assertStringIncludes(result.error, "storage unavailable");
  assertEquals(result.mayHaveCommitted, false);
});

Deno.test("req:application-shell-009 - unhandled events preserve state but advance event version", async () => {
  const store = new MemoryStateStore();
  await runtime(store).handle("Counter", "one", "Increment", payload());
  const d = definition();
  d.states.Ready.commands[0].decision = {
    kind: "emit",
    events: [{ name: "Unhandled", payload: { literal: null } }],
  };
  const result = await runtime(store, d).handle(
    "Counter",
    "one",
    "Increment",
    payload(),
  );
  assertEquals(result.kind, "accepted");
  assertEquals((await store.load("Counter", "one"))?.version, 2);
  assertEquals((await store.load("Counter", "one"))?.machine.fields.count, 1);
});

Deno.test("req:application-shell-009 - handler then exit then entry order", async () => {
  const d = definition();
  d.states.Ready.events[0].move = "Done";
  d.states.Ready.exit = { count: { field: "count", add: 10 } };
  const extended: AggregateDefinition<Pattern, Expression> = {
    ...d,
    states: {
      ...d.states,
      Done: {
        commands: [],
        events: [],
        entry: { count: { field: "count", add: 100 } },
      },
    },
  };
  const store = new MemoryStateStore();
  await runtime(store, extended).handle(
    "Counter",
    "one",
    "Increment",
    payload(),
  );
  assertEquals((await store.load("Counter", "one"))?.machine.fields.count, 111);
  assertEquals((await store.load("Counter", "one"))?.machine.state, "Done");
  assertEquals(
    (await runtime(store, extended).handle(
      "Counter",
      "one",
      "Increment",
      payload(),
    )).kind,
    "rejected",
  );
});

Deno.test("req:application-shell-009 - non-data values cannot escape permissive patterns", async () => {
  const store = new MemoryStateStore();
  assertEquals(
    (await runtime(store).handle("Counter", "one", "Ignore", new Error("host")))
      .kind,
    "rejected",
  );
  const d = definition();
  d.states.Ready.commands[0].decision = {
    kind: "emit",
    events: [{ name: "Unhandled", payload: { literal: () => 1 } }],
  };
  assertEquals(
    (await runtime(store, d).handle("Counter", "one", "Increment", payload()))
      .kind,
    "rejected",
  );
  assertEquals(await store.load("Counter", "one"), undefined);
});

Deno.test("req:application-shell-009 - ordered events see prior evolved fields", async () => {
  const d = definition();
  d.states.Ready.commands[0].decision = {
    kind: "emit",
    events: [
      { name: "Incremented", payload: { input: "self" } },
      { name: "Incremented", payload: { input: "self" } },
    ],
  };
  const store = new MemoryStateStore();
  const result = await runtime(store, d).handle(
    "Counter",
    "one",
    "Increment",
    payload(),
  );
  assertEquals(result.kind, "accepted");
  assertEquals((await store.load("Counter", "one"))?.machine.fields.count, 2);
  assertEquals((await store.load("Counter", "one"))?.version, 2);
});

Deno.test("req:application-shell-009 - thrown Save errors preserve uncertainty", async () => {
  const store = new MemoryStateStore();
  let calls = 0;
  const result = await runtime({
    load: store.load.bind(store),
    save: () => {
      calls++;
      throw new Error("connection lost");
    },
  }).handle("Counter", "one", "Increment", payload());
  if (result.kind !== "failed") throw new Error("expected failure");
  assertEquals(result.mayHaveCommitted, true);
  assertStringIncludes(result.error, "may stand");
  assertEquals(calls, 1);
});

Deno.test("req:application-shell-009 - identity cannot be changed by an accepted event", async () => {
  const store = new MemoryStateStore();
  await runtime(store).handle("Counter", "one", "Increment", payload());
  const result = await runtime(store).handle(
    "Counter",
    "one",
    "Increment",
    payload("other"),
  );
  assertEquals(result.kind, "rejected");
  assertEquals((await store.load("Counter", "one"))?.machine.fields.count, 1);
  assertEquals((await store.load("Counter", "one"))?.version, 1);
});
