import { assert, assertEquals } from "@std/assert";
import { PatternKind } from "@justinmchase/uffda/pattern";
import { parseApplicationSource } from "../src/uffda.ts";
import { expandShapeReferences } from "../src/shapes.ts";

const source = `export config Settings {
  mode: ("api" | "job");
}

export mode PublicApi: Web {
  controllers {
    Http.Controller controller;
  }
}

export program Shop {
  config Settings settings;
  mode settings.mode {
    "api" => PublicApi;
  }
}
`;

Deno.test(
  "req:application-shell-001 parses reusable shapes and typed mode parameters",
  async () => {
    const result = await parseApplicationSource(
      `export shape JobName = (string);
export config Settings { mode: ("job"); name: (JobName); }
export mode Batch(jobName: (JobName)): Job {
  jobs { Host.Import(jobName) import; }
}
export program Application {
  config Settings settings;
  mode settings.mode { "job" => Batch(settings.name); }
}`,
      "shapes.clsw",
    );
    assert(result.ok, result.ok ? "" : result.failure.message);
    const shape = result.syntax.declarations.find((declaration) =>
      declaration.kind === "shape"
    );
    assert(shape?.kind === "shape");
    assertEquals(shape.name, "JobName");
    assert(shape.span.start.offset > 0);
    const mode = result.syntax.declarations.find((declaration) =>
      declaration.kind === "mode"
    );
    assert(mode?.kind === "mode");
    assertEquals(mode.parameters.map((parameter) => parameter.name), [
      "jobName",
    ]);
    assert(mode.parameters[0].span.start.offset > 0);
    assertEquals(mode.parameters[0].pattern.kind, "resolve");
    const expanded = expandShapeReferences(
      mode.parameters[0].pattern,
      new Map([[
        "JobName",
        { name: "JobName", pattern: shape.pattern },
      ]]),
    );
    assert(expanded.ok, expanded.ok ? "" : expanded.message);
    if (expanded.ok) assertEquals(expanded.pattern.kind, PatternKind.Type);
    assertEquals(
      result.syntax.declarations.filter((declaration) =>
        declaration.kind === "export"
      ).map((declaration) => declaration.name),
      ["JobName", "Settings", "Batch", "Application"],
    );
  },
);

Deno.test(
  "req:application-shell-001 named shapes diagnose unknown names and cycles",
  async () => {
    const result = await parseApplicationSource(
      `shape First = (Second);
shape Second = (First);
export config Settings { mode: (Missing); }`,
      "bad-shapes.clsw",
    );
    assert(result.ok, result.ok ? "" : result.failure.message);
    const config = result.syntax.declarations.find((declaration) =>
      declaration.kind === "config"
    );
    assert(config?.kind === "config");
    const setting = config.settings[0];
    assert(setting.kind === "setting");
    const unknown = expandShapeReferences(setting.pattern, new Map());
    assertEquals(unknown.ok, false);
    if (!unknown.ok) {
      assertEquals(unknown.message, "Unknown named shape Missing");
    }
    const first = result.syntax.declarations.find((declaration) =>
      declaration.kind === "shape" && declaration.name === "First"
    );
    assert(first?.kind === "shape");
    const shapes = new Map(
      result.syntax.declarations.filter((declaration) =>
        declaration.kind === "shape"
      ).map((declaration) => [
        declaration.name,
        { name: declaration.name, pattern: declaration.pattern },
      ]),
    );
    const cyclic = expandShapeReferences(first.pattern, shapes);
    assertEquals(cyclic.ok, false);
    if (!cyclic.ok) assertEquals(cyclic.message.includes("cycle"), true);
  },
);

Deno.test(
  "req:application-shell-001 parses Uffda patterns into located typed declarations",
  async () => {
    const result = await parseApplicationSource(source, "app.clsw");
    assert(result.ok, result.ok ? "" : result.failure.message);
    assertEquals(result.syntax.kind, "module");
    assertEquals(result.syntax.source, "app.clsw");
    const config = result.syntax.declarations.find((declaration) =>
      declaration.kind === "config"
    );
    assert(config?.kind === "config");
    assertEquals(config.settings[0].name, "mode");
    assertEquals(config.settings[0].span?.source, "app.clsw");
    assert(config.settings[0].span!.start.offset > 0);
    assertEquals(
      result.syntax.declarations.map((declaration) => declaration.kind),
      ["export", "config", "export", "mode", "export", "program"],
    );
  },
);

Deno.test(
  "req:application-shell-001 rejects trailing invalid input with a source offset",
  async () => {
    const result = await parseApplicationSource(
      `${source}\nnot-an-application`,
      "broken.clsw",
    );
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.failure.message.includes("broken.clsw"), true);
      assert(result.failure.offset >= source.length);
    }
  },
);

Deno.test(
  "req:application-shell-001 inline start state preserves ordering and refuses separate or ambiguous starts",
  async () => {
    const source = `aggregate Counter {
  identity id: (string) = "";
  state Before {}
  start state Ready {}
  state After {}
}`;
    const parsed = await parseApplicationSource(source, "start-state.clsw");
    assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
    const aggregate = parsed.syntax.declarations.find((declaration) =>
      declaration.kind === "aggregate"
    );
    assert(aggregate?.kind === "aggregate");
    assertEquals(aggregate.start, "Ready");
    assertEquals(aggregate.states.map((state) => state.name), [
      "Before",
      "Ready",
      "After",
    ]);
    for (const state of aggregate.states) {
      assert(state.span);
      assertEquals(
        source.slice(state.span.start.offset, state.span.end.offset),
        `${state.name === "Ready" ? "start " : ""}state ${state.name} {}`,
      );
    }
    for (
      const invalid of [
        source.replace("start state Ready {}", "start Ready; state Ready {}"),
        source.replace("start state Ready {}", "state Ready {}"),
        source.replace("state After {}", "start state After {}"),
      ]
    ) {
      const refused = await parseApplicationSource(
        invalid,
        "invalid-start.clsw",
      );
      assertEquals(refused.ok, false);
    }
  },
);

Deno.test(
  "req:application-shell-009 parses a context-owned event-evolving aggregate",
  async () => {
    const result = await parseApplicationSource(
      `export context CounterContext {
  counter: Counter;
  manager: CounterManager(counter);
  export http: CounterController(manager);
}

shape IncrementInput = ({ id: string, by: number });

aggregate Counter {
  identity id: (string) = null;
  field count: (number) = 0;
  command Increment: (IncrementInput);
  event Incremented: ({ id: string, by: number });
  start state Ready {
    command Increment {
      emit Incremented: input;
    }
    event Incremented {
      set id = input.id;
      set count = (add state.fields.count input.by);
    }
  }
}

manager CounterManager(counter: Counter) {
  operation Increment {
    input: (IncrementInput);
    result: (any);
    send counter.Increment {
      identity: input.id;
      payload: input;
    }
  }
}

controller CounterController(manager: CounterManager) {
  route POST "/counters/{id}" public {
    operation manager.Increment;
    path: ({ id: string });
    body: ({ by: number });
    input: { id: request.path.id, by: request.body.by };
  }
}`,
      "counter.clsw",
    );
    assert(result.ok, result.ok ? "" : result.failure.message);
    const context = result.syntax.declarations.find((declaration) =>
      declaration.kind === "context"
    );
    assert(context?.kind === "context");
    assertEquals(context.members.map((member) => member.name), [
      "counter",
      "manager",
      "http",
    ]);
    assertEquals(context.members.map((member) => member.exported), [
      false,
      false,
      true,
    ]);
    assertEquals(context.members.map((member) => member.declaration), [
      "Counter",
      "CounterManager",
      "CounterController",
    ]);
    const aggregate = result.syntax.declarations.find((declaration) =>
      declaration.kind === "aggregate"
    );
    assert(aggregate?.kind === "aggregate");
    assertEquals(aggregate.identityField, "id");
    assertEquals(aggregate.start, "Ready");
    assertEquals(aggregate.fields.map((field) => field.name), ["id", "count"]);
    assertEquals(aggregate.states[0].commands[0].decision.kind, "emit");
    assertEquals(
      aggregate.states[0].events[0].set.map((field) => field.field),
      [
        "id",
        "count",
      ],
    );
    const manager = result.syntax.declarations.find((declaration) =>
      declaration.kind === "manager"
    );
    assert(manager?.kind === "manager");
    assertEquals(manager.operations[0].name, "Increment");
    assertEquals(manager.parameters[0].name, "counter");
    assertEquals(manager.operations[0].aggregateParameter, "counter");
    const controller = result.syntax.declarations.find((declaration) =>
      declaration.kind === "controller"
    );
    assert(controller?.kind === "controller");
    assertEquals(controller.routes[0].method, "POST");
    assertEquals(controller.routes[0].path, "/counters/{id}");
    assertEquals(controller.routes[0].public, true);
    assertEquals(
      controller.routes[0].requestShapes.map((shape) => shape.kind),
      ["path", "body"],
    );
    assertEquals(controller.routes[0].operation.segments, [
      "manager",
      "Increment",
    ]);
    assert(aggregate.fields[0].span.start.offset > 0);
    assert(aggregate.states[0].events[0].set[0].span.start.offset > 0);
  },
);
