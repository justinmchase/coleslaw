import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  BUILTIN_MODES,
  checkApplication,
  modeComposition,
} from "../src/application.ts";
import { checkComposition, startComposition } from "../src/composition.ts";
import { MemoryStateStore } from "../src/domain.ts";
import {
  createDeclarativeHostComponents,
  validateDeclarativeDomain,
} from "../src/domain-runtime.ts";
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
        "export CounterController;",
        "export CounterController;\n  export ReadController;",
      )
      .replace(
        "path: ({ id: string });",
        'path: ({ id: ("write" | "read") });',
      )
      .replace(
        "\nexport config CounterSettings",
        `
controller ReadController {
  route GET "/counters/{id}" public {
    operation IncrementCounter.Increment;
    path: ({ id: "read" });
    input: { id: request.path.id, by: 0 };
  }
}

export config CounterSettings`,
      )
      .replace(
        "CounterContext.CounterController http;",
        `CounterContext.CounterController http;
    CounterContext.ReadController reader;`,
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
        "manager IncrementCounter",
        "export manager IncrementCounter",
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
        "CounterContext.CounterController http;",
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
        "export mode CounterApi: Web {\n  managers { IncrementCounter commands; }",
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
        "context OtherContext { Counter; }\nexport context CounterContext {",
      ).replace("  Counter;\n", ""),
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
  OtherCounter;
  OtherManager;
  export OtherController;
}
aggregate OtherCounter {
  identity id: (string) = "";
  field count: (number) = 0;
  command Increment: ({ id: string, by: number });
  event Incremented: ({ id: string, by: number });
  start Ready;
  state Ready {
    command Increment {
      emit Incremented: input;
    }
    event Incremented {
      set id = input.id;
      set count = (add state.fields.count input.by);
    }
  }
}
manager OtherManager {
  operation Increment {
    input: ({ id: string, by: number });
    result: (any);
    send OtherCounter.Increment {
      identity: input.id;
      payload: input;
    }
  }
}
controller OtherController {
  route POST "/others/{id}" public {
    operation OtherManager.Increment;
    path: ({ id: string });
    body: ({ by: number });
    input: { id: request.path.id, by: request.body.by };
  }
}
`;
    const multiContext = await parseApplicationSource(
      source.replace(
        "  controllers {\n    CounterContext.CounterController http;\n  }",
        `  controllers {
    CounterContext.CounterController http;
    OtherContext.OtherController otherHttp;
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
    const managerDescriptor = descriptors.get("IncrementCounter");
    assert(managerDescriptor);
    const resource = await managerDescriptor.create([]);
    const manager = resource.value as {
      invoke(operation: string, input: unknown): Promise<{
        kind: string;
        version?: number;
      }>;
    };

    assertEquals(
      (await manager.invoke("Increment", {
        id: "strict-shape",
        by: 2,
        unexpected: true,
      })).kind,
      "refused",
    );
    const accepted = await manager.invoke("Increment", {
      id: "strict-shape",
      by: 2,
    });
    assertEquals(accepted.kind, "accepted");
    assertEquals(accepted.version, 1);
    await resource.dispose?.();
  },
);
