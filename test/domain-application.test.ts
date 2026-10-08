import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  BUILTIN_MODES,
  checkApplication,
  modeComposition,
} from "../src/application.ts";
import { checkComposition, startComposition } from "../src/composition.ts";
import { MemoryStateStore, type StateStore } from "../src/domain.ts";
import {
  createDeclarativeHostComponents,
  validateDeclarativeDomain,
} from "../src/domain-runtime.ts";
import { resolveApplicationImports } from "../src/imports.ts";
import { parseApplicationSource } from "../src/uffda.ts";

async function assertProblem(
  response: Response,
  status: number,
): Promise<Record<string, unknown>> {
  assertEquals(response.status, status);
  assert(
    response.headers.get("content-type")?.startsWith(
      "application/problem+json",
    ),
  );
  const body = await response.json();
  assertEquals(body.status, status);
  assertEquals(body.type, "about:blank");
  return body;
}

Deno.test(
  "req:application-shell-011 imported domain declarations are explicitly unsupported context bindings",
  async () => {
    const folder = `bin/context-import-${crypto.randomUUID()}`;
    const importedPath = `${folder}/counter.clsw`;
    const sourcePath = `${folder}/app.clsw`;
    const importedSource = `
export aggregate ImportedCounter {
  identity id: (string) = "";
  field count: (number) = 0;
  command Increment: ({ id: string });
  event Incremented: ({ id: string });
  start state Ready {
    command Increment { emit Incremented: input; }
    event Incremented { set id = input.id; }
  }
}
`;
    const source = `
import "./counter.clsw" ImportedCounter;
context LocalContext {
  counter: ImportedCounter;
}
`;
    try {
      await Deno.mkdir(folder, { recursive: true });
      await Deno.writeTextFile(importedPath, importedSource);
      await Deno.writeTextFile(sourcePath, source);
      const parsed = await parseApplicationSource(source, sourcePath);
      assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
      const imports = await resolveApplicationImports(
        parsed.syntax,
        sourcePath,
      );
      assert(imports.ok, imports.ok ? "" : imports.diagnostics[0]?.message);

      const diagnostics = validateDeclarativeDomain(
        parsed.syntax,
        new Map(),
        imports.resolved.declarations,
      );
      assert(
        diagnostics.some((problem) =>
          problem.code === "UNSUPPORTED_IMPORTED_CONTEXT_BINDING"
        ),
        "an imported aggregate used as a context binding must fail explicitly",
      );
      assertEquals(
        diagnostics.some((problem) =>
          problem.code === "UNKNOWN_CONTEXT_MEMBER"
        ),
        false,
        "imported domain declarations must not be reported as merely unknown",
      );
    } finally {
      await Deno.remove(folder, { recursive: true });
    }
  },
);

Deno.test(
  "req:application-shell-011 explicit context bindings support aliases without changing aggregate identity",
  async () => {
    const source = await Deno.readTextFile("examples/domain/counter.clsw");
    const aliases = source
      .replace(
        "manager: CounterManager(counter);",
        `manager: CounterManager(counter);
  secondaryCounter: Counter;
  secondaryManager: CounterManager(secondaryCounter);`,
      )
      .replace(
        "export http: CounterController(manager);",
        `export http: CounterController(manager);
  export secondaryHttp: CounterController(secondaryManager);`,
      );
    const parsed = await parseApplicationSource(
      aliases,
      "context-aliases.clsw",
    );
    assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
    assertEquals(validateDeclarativeDomain(parsed.syntax), []);

    const baseStore = new MemoryStateStore();
    const aggregateKinds: string[] = [];
    const stateStore: StateStore = {
      async load(kind, identity) {
        aggregateKinds.push(kind);
        return await baseStore.load(kind, identity);
      },
      save: baseStore.save.bind(baseStore),
    };
    const descriptors = createDeclarativeHostComponents(parsed.syntax, {
      stateStore,
    });
    const invoke = async (name: string, by: number) => {
      const descriptor = descriptors.get(name);
      assert(descriptor);
      const resource = await descriptor.create([]);
      const controller = resource.value as {
        handle(request: Request): Promise<Response>;
      };
      try {
        return await controller.handle(
          new Request("http://localhost/counters/c-1", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ by }),
          }),
        );
      } finally {
        await resource.dispose?.();
      }
    };

    const first = await invoke("CounterContext.http", 2);
    assertEquals(first.status, 200);
    assertEquals((await first.json()).version, 1);
    const second = await invoke("CounterContext.secondaryHttp", 3);
    assertEquals(second.status, 200);
    assertEquals((await second.json()).version, 2);
    assertEquals(new Set(aggregateKinds), new Set(["CounterContext.Counter"]));
    assertEquals(
      (await baseStore.load("CounterContext.Counter", "c-1"))
        ?.machine.fields.count,
      5,
    );
  },
);

Deno.test(
  "req:application-shell-011 invalid or ambient context dependencies fail without storage access",
  async () => {
    const source = await Deno.readTextFile("examples/domain/counter.clsw");
    const candidates = [
      {
        source: source.replace(
          "CounterManager(counter)",
          "CounterManager(missing)",
        ),
        codes: ["UNKNOWN_CONTEXT_BINDING"],
      },
      {
        source: source.replace(
          "CounterManager(counter)",
          "CounterManager(counter counter)",
        ),
        codes: ["INVALID_CONTEXT_ARGUMENT_COUNT"],
      },
      {
        source: source.replace(
          "CounterManager(counter)",
          "CounterManager",
        ),
        codes: ["INVALID_CONTEXT_ARGUMENT_COUNT"],
      },
      {
        source: source.replace(
          "  counter: Counter;\n",
          "  counter: Counter;\n  counter: Counter;\n",
        ),
        codes: ["DUPLICATE_DOMAIN_MEMBER"],
      },
      {
        source: source.replace(
          "CounterManager(counter: Counter)",
          "CounterManager(counter: Counter counter: Counter)",
        ),
        codes: ["DUPLICATE_DOMAIN_MEMBER"],
      },
      {
        source: source.replace(
          "send counter.Increment",
          "send Counter.Increment",
        ),
        codes: ["UNKNOWN_MANAGER_AGGREGATE"],
      },
      {
        source: source.replace(
          "operation manager.Increment",
          "operation CounterManager.Increment",
        ),
        codes: ["UNKNOWN_CONTROLLER_OPERATION"],
      },
      {
        source: source.replace(
          "CounterManager(counter)",
          "CounterManager(http)",
        ),
        codes: [
          "INVALID_CONTEXT_ARGUMENT_TYPE",
          "CONTEXT_DEPENDENCY_CYCLE",
        ],
      },
    ];
    const baseStore = new MemoryStateStore();
    let storeCalls = 0;
    const stateStore: StateStore = {
      load: async (...arguments_) => {
        storeCalls++;
        return await baseStore.load(...arguments_);
      },
      save: async (...arguments_) => {
        storeCalls++;
        return await baseStore.save(...arguments_);
      },
    };
    for (const [index, candidate] of candidates.entries()) {
      const parsed = await parseApplicationSource(
        candidate.source,
        `invalid-context-${index}.clsw`,
      );
      assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
      const diagnostics = validateDeclarativeDomain(parsed.syntax);
      for (const code of candidate.codes) {
        assert(
          diagnostics.some((problem) => problem.code === code),
          `expected ${code}, got ${
            diagnostics.map((problem) => problem.code).join(", ")
          }`,
        );
      }
      createDeclarativeHostComponents(parsed.syntax, { stateStore });
    }
    assertEquals(storeCalls, 0);
  },
);

Deno.test(
  "req:application-shell-010 declarative command runs through a loopback HTTP listener",
  async () => {
    const path = "examples/domain/counter.clsw";
    const parsed = await parseApplicationSource(
      await Deno.readTextFile(path),
      path,
    );
    assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
    const domainProblems = validateDeclarativeDomain(parsed.syntax);
    assertEquals(domainProblems, []);
    const stateStore = new MemoryStateStore();
    const componentDescriptors = createDeclarativeHostComponents(
      parsed.syntax,
      { stateStore },
    );
    const checked = checkApplication(parsed.syntax, { componentDescriptors });
    assert(checked.ok, checked.ok ? "" : checked.diagnostics[0]?.message);

    const declaration = checked.checked.modes.get("CounterApi");
    assert(declaration);
    const composition = modeComposition(
      declaration,
      componentDescriptors,
      checked.checked.program.configBinding,
      [],
    );
    assert(composition);
    const composed = checkComposition(
      composition,
      BUILTIN_MODES.Web,
      componentDescriptors,
    );
    assert(composed.ok, composed.ok ? "" : composed.problems[0]?.message);
    const running = await startComposition(composed.checked, {
      settingValue: () => undefined,
    });
    const abort = new AbortController();
    let announceListening!: (
      address: { hostname: string; port: number },
    ) => void;
    let rejectListening!: (error: unknown) => void;
    const listening = new Promise<{ hostname: string; port: number }>(
      (resolve, reject) => {
        announceListening = resolve;
        rejectListening = reject;
      },
    );
    const modeRun = running.run([0, "127.0.0.1"], {
      signal: abort.signal,
      onListen: announceListening,
    });
    void modeRun.catch(rejectListening);
    let address: { hostname: string; port: number } | undefined;

    try {
      address = await listening;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const send = (body: string, url = "/counters/c-1") =>
        fetch(`${baseUrl}${url}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
      const first = await send(JSON.stringify({ by: 2 }));
      assertEquals(first.status, 200);
      assertEquals(await first.json(), {
        kind: "accepted",
        events: [{
          name: "Incremented",
          payload: { id: "c-1", by: 2, count: 2 },
        }],
        version: 1,
      });

      const second = await send(JSON.stringify({ by: 3 }));
      assertEquals(second.status, 200);
      assertEquals(await second.json(), {
        kind: "accepted",
        events: [{
          name: "Incremented",
          payload: { id: "c-1", by: 3, count: 5 },
        }],
        version: 2,
      });
      const stored = await stateStore.load(
        "CounterContext.Counter",
        "c-1",
      );
      assert(stored);
      assertEquals(stored.version, 2);
      assertEquals(stored.machine.fields.count, 5);

      const refusedShape = await send(JSON.stringify({ by: "not-a-number" }));
      await assertProblem(refusedShape, 400);

      const refusedExtraBody = await send(
        JSON.stringify({ by: 1, ignored: true }),
      );
      await assertProblem(refusedExtraBody, 400);

      const refusedQuery = await send(
        JSON.stringify({ by: 1 }),
        "/counters/c-1?ignored=true",
      );
      await assertProblem(refusedQuery, 400);

      const malformedJson = await send("{");
      await assertProblem(malformedJson, 400);

      const unsupportedMediaType = await fetch(
        `${baseUrl}/counters/c-1`,
        {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "by=1",
        },
      );
      await assertProblem(unsupportedMediaType, 415);

      const refusedBody = await send("");
      await assertProblem(refusedBody, 400);

      const unknownPath = await fetch(`${baseUrl}/unknown`, {
        method: "POST",
      });
      await assertProblem(unknownPath, 404);

      const repeatedSlash = await fetch(
        `${baseUrl}/counters//c-1`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ by: 1 }),
        },
      );
      await assertProblem(repeatedSlash, 404);

      const unsupportedMethod = await fetch(
        `${baseUrl}/counters/c-1`,
        { method: "GET" },
      );
      await assertProblem(unsupportedMethod, 405);
      assertEquals(unsupportedMethod.headers.get("allow"), "POST");
    } finally {
      abort.abort();
      try {
        await modeRun;
      } finally {
        await running.dispose();
      }
    }
    assert(address);
    await assertRejects(() => fetch(`http://127.0.0.1:${address.port}`));
  },
);

Deno.test(
  "req:application-shell-010 Web shutdown preserves unrelated server failures",
  async () => {
    const abort = new AbortController();
    await assertRejects(
      async () => {
        await BUILTIN_MODES.Web.run([], [0, "127.0.0.1"], {
          signal: abort.signal,
          onListen: () => {
            abort.abort();
            throw new Error("listener callback failed");
          },
        });
      },
      Error,
      "listener callback failed",
    );
  },
);

Deno.test(
  "req:application-shell-010 ordered controllers aggregate methods and skip path-shape mismatches",
  async () => {
    const source = await Deno.readTextFile("examples/domain/counter.clsw");
    const routedSource = source
      .replace(
        "export http: CounterController(manager);",
        "export http: CounterController(manager);\n  export read: ReadController(manager);",
      )
      .replace(
        "path: ({ id: string });",
        'path: ({ id: ("write" | "read") });',
      )
      .replace(
        "\nexport config CounterSettings",
        `
controller ReadController(manager: CounterManager) {
  route GET "/counters/{id}" public {
    operation manager.Increment;
    path: ({ id: "read" });
    input: { id: request.path.id, by: 0 };
  }
}

export config CounterSettings`,
      )
      .replace(
        "CounterContext.http http;",
        `CounterContext.http http;
    CounterContext.read reader;`,
      );
    const parsed = await parseApplicationSource(
      routedSource,
      "ordered-routes.clsw",
    );
    assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
    assertEquals(validateDeclarativeDomain(parsed.syntax), []);
    const componentDescriptors = createDeclarativeHostComponents(
      parsed.syntax,
    );
    const checked = checkApplication(parsed.syntax, { componentDescriptors });
    assert(checked.ok, checked.ok ? "" : checked.diagnostics[0]?.message);
    const declaration = checked.checked.modes.get("CounterApi");
    assert(declaration);
    const composition = modeComposition(
      declaration,
      componentDescriptors,
      checked.checked.program.configBinding,
      [],
    );
    assert(composition);
    const composed = checkComposition(
      composition,
      BUILTIN_MODES.Web,
      componentDescriptors,
    );
    assert(composed.ok, composed.ok ? "" : composed.problems[0]?.message);
    const running = await startComposition(composed.checked, {
      settingValue: () => undefined,
    });
    const abort = new AbortController();
    let announceListening!: (
      address: { hostname: string; port: number },
    ) => void;
    let rejectListening!: (error: unknown) => void;
    const listening = new Promise<{ hostname: string; port: number }>(
      (resolve, reject) => {
        announceListening = resolve;
        rejectListening = reject;
      },
    );
    const modeRun = running.run([0, "127.0.0.1"], {
      signal: abort.signal,
      onListen: announceListening,
    });
    void modeRun.catch(rejectListening);

    try {
      const address = await listening;
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const read = await fetch(`${baseUrl}/counters/read`);
      assertEquals(read.status, 200);
      assertEquals((await read.json()).kind, "accepted");

      const writeOnRead = await fetch(`${baseUrl}/counters/write`);
      assertEquals(writeOnRead.status, 405);
      assertEquals(writeOnRead.headers.get("allow"), "POST");

      const unsupported = await fetch(`${baseUrl}/counters/read`, {
        method: "PUT",
      });
      assertEquals(unsupported.status, 405);
      assertEquals(unsupported.headers.get("allow"), "POST, GET");

      const pathShapeMismatch = await fetch(`${baseUrl}/counters/other`);
      await assertProblem(pathShapeMismatch, 404);
    } finally {
      abort.abort();
      await running.dispose();
    }
  },
);

Deno.test(
  "req:application-shell-010 omitted access and public principal use fail checking",
  async () => {
    const source = await Deno.readTextFile("examples/domain/counter.clsw");
    const omittedPublic = await parseApplicationSource(
      source.replace('"/counters/{id}" public', '"/counters/{id}"'),
      "omitted-public.clsw",
    );
    assert(
      omittedPublic.ok,
      omittedPublic.ok ? "" : omittedPublic.failure.message,
    );
    const omittedDiagnostics = validateDeclarativeDomain(omittedPublic.syntax);
    assert(
      omittedDiagnostics.some((problem) =>
        problem.code === "ROUTE_ACCESS_REQUIRED"
      ),
    );

    const unsupportedAuthentication = await parseApplicationSource(
      source.replace(
        '"/counters/{id}" public',
        '"/counters/{id}" authenticated',
      ),
      "unsupported-authentication.clsw",
    );
    assertEquals(
      unsupportedAuthentication.ok,
      false,
      "authenticated routes must not be accepted as anonymous public routes",
    );

    const unsupportedService = await parseApplicationSource(
      `${source}\nservice Mailer { operation Send; }`,
      "unsupported-service.clsw",
    );
    assertEquals(
      unsupportedService.ok,
      false,
      "unsupported service declarations must be rejected",
    );

    const publicPrincipal = await parseApplicationSource(
      source.replace("by: request.body.by", "by: principal.id"),
      "public-principal.clsw",
    );
    assert(
      publicPrincipal.ok,
      publicPrincipal.ok ? "" : publicPrincipal.failure.message,
    );
    const principalDiagnostics = validateDeclarativeDomain(
      publicPrincipal.syntax,
    );
    assert(
      principalDiagnostics.some((problem) =>
        problem.code === "PUBLIC_ROUTE_PRINCIPAL"
      ),
    );

    const privateExport = await parseApplicationSource(
      source.replace(
        "manager CounterManager",
        "export manager CounterManager",
      ),
      "private-export.clsw",
    );
    assert(
      privateExport.ok,
      privateExport.ok ? "" : privateExport.failure.message,
    );
    const exportDiagnostics = validateDeclarativeDomain(privateExport.syntax);
    assert(
      exportDiagnostics.some((problem) =>
        problem.code === "PRIVATE_DOMAIN_MEMBER"
      ),
    );

    const privateContext = await parseApplicationSource(
      source.replace(
        "export context CounterContext",
        "context CounterContext",
      ),
      "private-context.clsw",
    );
    assert(
      privateContext.ok,
      privateContext.ok ? "" : privateContext.failure.message,
    );
    const contextDiagnostics = validateDeclarativeDomain(
      privateContext.syntax,
    );
    assert(
      contextDiagnostics.some((problem) =>
        problem.code === "CONTROLLER_NOT_EXPORTED_BY_CONTEXT"
      ),
    );

    const directController = await parseApplicationSource(
      source.replace(
        "CounterContext.http http;",
        "CounterController http;",
      ),
      "direct-controller.clsw",
    );
    assert(
      directController.ok,
      directController.ok ? "" : directController.failure.message,
    );
    const directControllerDiagnostics = validateDeclarativeDomain(
      directController.syntax,
    );
    assert(
      directControllerDiagnostics.some((problem) =>
        problem.code === "CONTROLLER_NOT_EXPORTED_BY_CONTEXT"
      ),
    );

    const directManager = await parseApplicationSource(
      source.replace(
        "export mode CounterApi: Web {",
        "export mode CounterApi: Web {\n  managers { CounterManager commands; }",
      ),
      "direct-manager.clsw",
    );
    assert(
      directManager.ok,
      directManager.ok ? "" : directManager.failure.message,
    );
    const directManagerDiagnostics = validateDeclarativeDomain(
      directManager.syntax,
    );
    assert(
      directManagerDiagnostics.some((problem) =>
        problem.code === "CROSS_CONTEXT_MANAGER_ACCESS"
      ),
    );

    const crossContext = await parseApplicationSource(
      source.replace(
        "export context CounterContext {",
        "context OtherContext { counter: Counter; }\nexport context CounterContext {",
      ).replace("  counter: Counter;\n", ""),
      "cross-context.clsw",
    );
    assert(
      crossContext.ok,
      crossContext.ok ? "" : crossContext.failure.message,
    );
    const ownershipDiagnostics = validateDeclarativeDomain(crossContext.syntax);
    assert(
      ownershipDiagnostics.some((problem) =>
        problem.code === "CROSS_CONTEXT_AGGREGATE_ACCESS"
      ),
    );

    const mismatchedPathShape = await parseApplicationSource(
      source.replace("path: ({ id: string });", "path: ({ other: string });"),
      "mismatched-path.clsw",
    );
    assert(
      mismatchedPathShape.ok,
      mismatchedPathShape.ok ? "" : mismatchedPathShape.failure.message,
    );
    const pathShapeDiagnostics = validateDeclarativeDomain(
      mismatchedPathShape.syntax,
    );
    assert(
      pathShapeDiagnostics.some((problem) =>
        problem.code === "PATH_SHAPE_MISMATCH"
      ),
    );

    const secondContext = `
export context OtherContext {
  otherCounter: OtherCounter;
  otherManager: OtherManager(otherCounter);
  export otherHttp: OtherController(otherManager);
}
aggregate OtherCounter {
  identity id: (string) = "";
  field count: (number) = 0;
  command Increment: ({ id: string, by: number });
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
manager OtherManager(otherCounter: OtherCounter) {
  operation Increment {
    input: ({ id: string, by: number });
    result: (any);
    send otherCounter.Increment {
      identity: input.id;
      payload: input;
    }
  }
}
controller OtherController(otherManager: OtherManager) {
  route POST "/others/{id}" public {
    operation otherManager.Increment;
    path: ({ id: string });
    body: ({ by: number });
    input: { id: request.path.id, by: request.body.by };
  }
}
`;
    const multiContext = await parseApplicationSource(
      source.replace(
        "  controllers {\n    CounterContext.http http;\n  }",
        `  controllers {
    CounterContext.http http;
    OtherContext.otherHttp otherHttp;
  }`,
      ) + secondContext,
      "multi-context.clsw",
    );
    assert(
      multiContext.ok,
      multiContext.ok ? "" : multiContext.failure.message,
    );
    const multiContextDiagnostics = validateDeclarativeDomain(
      multiContext.syntax,
    );
    assertEquals(
      multiContextDiagnostics.filter((problem) =>
        problem.code === "CROSS_CONTEXT_MANAGER_ACCESS"
      ),
      [],
    );
  },
);

Deno.test(
  "req:application-shell-009 production Uffda shapes reject undeclared input keys",
  async () => {
    const path = "examples/domain/counter.clsw";
    const parsed = await parseApplicationSource(
      await Deno.readTextFile(path),
      path,
    );
    assert(parsed.ok, parsed.ok ? "" : parsed.failure.message);
    const descriptors = createDeclarativeHostComponents(parsed.syntax);
    const controllerDescriptor = descriptors.get("CounterContext.http");
    assert(controllerDescriptor);
    const resource = await controllerDescriptor.create([]);
    const controller = resource.value as {
      handle(request: Request): Promise<Response>;
    };
    const response = await controller.handle(
      new Request("http://localhost/counters/strict-shape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          by: 2,
          unexpected: true,
        }),
      }),
    );
    assertEquals(response.status, 400);
    await resource.dispose?.();
  },
);
