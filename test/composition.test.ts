import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  checkComposition,
  type ComponentBinding,
  type ComponentCategory,
  type HostComponentDescriptor,
  type HostModeDescriptor,
  type ModeComposition,
  startComposition,
} from "../src/composition.ts";

function component(
  kind: ComponentCategory,
  parameters: HostComponentDescriptor["parameters"],
  create: HostComponentDescriptor["create"],
): HostComponentDescriptor {
  return { kind, parameters, create };
}

const web: HostModeDescriptor = {
  kind: "Web",
  traversal: "limited",
  entryPoint: "controller",
  run: () => {},
};

function checked(
  mode: ModeComposition,
  descriptors: ReadonlyMap<string, HostComponentDescriptor>,
  descriptor = web,
) {
  const result = checkComposition(mode, descriptor, descriptors);
  assert(result.ok, result.ok ? "" : JSON.stringify(result.problems));
  return result.checked;
}

function binding(
  name: string,
  componentName: string,
  category: ComponentCategory,
  descriptor: HostComponentDescriptor,
  arguments_: ComponentBinding["arguments"] = [],
): ComponentBinding {
  return {
    name,
    component: componentName,
    category,
    descriptor,
    arguments: arguments_,
  };
}

Deno.test(
  "req:application-shell-005 composition validates explicit dependencies and Web capabilities",
  () => {
    const service = component("service", [], () => ({ value: {} }));
    const controller = component("controller", [{
      name: "manager",
      type: { kind: "component", category: "manager" },
    }], () => ({ value: {} }));
    const invalidController = component("controller", [{
      name: "database",
      type: { kind: "component", category: "service" },
    }], () => ({ value: {} }));
    const manager = component("manager", [{
      name: "repository",
      type: { kind: "component", category: "repository" },
    }], () => ({ value: {} }));
    const repository = component("repository", [], () => ({ value: {} }));
    const descriptors = new Map([
      ["Controller", controller],
      ["Database", service],
      ["Manager", manager],
      ["Repository", repository],
    ]);
    const valid: ModeComposition = {
      kind: "Web",
      sections: {
        repository: [binding("repo", "Repository", "repository", repository)],
        manager: [
          binding("manager", "Manager", "manager", manager, [{
            kind: "binding",
            name: "repo",
          }]),
        ],
        controller: [
          binding("api", "Controller", "controller", controller, [{
            kind: "binding",
            name: "manager",
          }]),
        ],
      },
    };
    assert(checked(valid, descriptors));

    const illegal: ModeComposition = {
      kind: "Web",
      sections: {
        service: [binding("db", "Database", "service", service)],
        controller: [
          binding("api", "Controller", "controller", invalidController, [{
            kind: "binding",
            name: "db",
          }]),
        ],
      },
    };
    const result = checkComposition(
      illegal,
      web,
      new Map([
        ["Database", service],
        ["Controller", invalidController],
      ]),
    );
    assert(!result.ok);
    assert(
      result.problems.some((problem) =>
        problem.code === "INVALID_ARGUMENT_TYPE"
      ),
    );

    const fullTraversalWeb: HostModeDescriptor = {
      ...web,
      traversal: "full",
    };
    const webResult = checkComposition(valid, fullTraversalWeb, descriptors);
    assert(!webResult.ok);
    assert(
      webResult.problems.some((problem) =>
        problem.code === "INVALID_DESCRIPTOR"
      ),
    );
  },
);

Deno.test(
  "req:application-shell-005 composition rejects missing, duplicate, and cyclic bindings",
  () => {
    const manager = component("manager", [{
      name: "other",
      type: { kind: "component", category: "manager" },
    }], () => ({ value: {} }));
    const controller = component("controller", [], () => ({ value: {} }));
    const cycle: ModeComposition = {
      kind: "Web",
      sections: {
        manager: [
          binding("a", "Manager", "manager", manager, [{
            kind: "binding",
            name: "b",
          }]),
          binding("b", "Manager", "manager", manager, [{
            kind: "binding",
            name: "a",
          }]),
        ],
        controller: [
          binding("api", "Controller", "controller", controller, []),
        ],
      },
    };
    const result = checkComposition(
      cycle,
      web,
      new Map([
        ["Manager", manager],
        ["Controller", controller],
      ]),
    );
    assert(!result.ok);
    assert(
      result.problems.some((problem) => problem.code === "DEPENDENCY_CYCLE"),
    );

    const duplicate: ModeComposition = {
      kind: "Web",
      sections: {
        controller: [
          binding("api", "Controller", "controller", controller),
          binding("api", "Controller", "controller", controller),
        ],
      },
    };
    const duplicateResult = checkComposition(
      duplicate,
      web,
      new Map([
        ["Controller", controller],
      ]),
    );
    assert(!duplicateResult.ok);
    assert(
      duplicateResult.problems.some((problem) =>
        problem.code === "DUPLICATE_BINDING"
      ),
    );

    const missing: ModeComposition = {
      kind: "Web",
      sections: {
        controller: [
          binding("api", "Missing", "controller", controller),
        ],
      },
    };
    const missingResult = checkComposition(missing, web, new Map());
    assert(!missingResult.ok);
    assert(
      missingResult.problems.some((problem) =>
        problem.code === "UNKNOWN_BINDING"
      ),
    );
  },
);

Deno.test(
  "req:application-shell-006 constructs only reached dependencies once in order and disposes in reverse",
  async () => {
    const log: string[] = [];
    const service = component("service", [], () => {
      log.push("service+");
      return {
        value: "service",
        dispose: () => {
          log.push("service-");
        },
      };
    });
    const repository = component("repository", [], () => {
      log.push("repository+");
      return {
        value: "repository",
        dispose: () => {
          log.push("repository-");
        },
      };
    });
    const manager = component("manager", [{
      name: "repository",
      type: { kind: "component", category: "repository" },
    }], ([value]) => {
      log.push(`manager+${value}`);
      return {
        value: "manager",
        dispose: () => {
          log.push("manager-");
        },
      };
    });
    const controller = component("controller", [{
      name: "manager",
      type: { kind: "component", category: "manager" },
    }], ([value]) => {
      log.push(`controller+${value}`);
      return {
        value: "controller",
        dispose: () => {
          log.push("controller-");
        },
      };
    });
    let unusedConstructions = 0;
    const unused = component("service", [], () => {
      unusedConstructions++;
      return { value: "unused" };
    });
    const mode: ModeComposition = {
      kind: "Web",
      sections: {
        service: [
          binding("logging", "Logger", "service", service),
          binding("unused", "Unused", "service", unused),
        ],
        repository: [
          binding("repo", "Repository", "repository", repository),
        ],
        manager: [
          binding("mgr", "Manager", "manager", manager, [{
            kind: "binding",
            name: "repo",
          }]),
        ],
        controller: [
          binding("api", "Controller", "controller", controller, [{
            kind: "binding",
            name: "mgr",
          }]),
        ],
      },
    };
    const descriptors = new Map([
      ["Logger", service],
      ["Unused", unused],
      ["Repository", repository],
      ["Manager", manager],
      ["Controller", controller],
    ]);
    const started = await startComposition(checked(mode, descriptors), {
      settingValue: () => undefined,
    });
    assertEquals(log, [
      "repository+",
      "manager+repository",
      "controller+manager",
    ]);
    assertEquals(unusedConstructions, 0);
    assertEquals(started.rootValues, ["controller"]);
    await started.dispose();
    assertEquals(log, [
      "repository+",
      "manager+repository",
      "controller+manager",
      "controller-",
      "manager-",
      "repository-",
    ]);
  },
);

Deno.test(
  "req:application-shell-006 disposes partial startup in reverse and reports cleanup failure",
  async () => {
    const log: string[] = [];
    const first = component("infrastructure", [], () => {
      log.push("first+");
      return {
        value: {},
        dispose: () => {
          log.push("first-");
        },
      };
    });
    const second = component("infrastructure", [], () => {
      log.push("second+");
      throw new Error("construction failed");
    });
    const controller = component("controller", [
      {
        name: "first",
        type: { kind: "component", category: "infrastructure" },
      },
      {
        name: "second",
        type: { kind: "component", category: "infrastructure" },
      },
    ], () => ({ value: {} }));
    const mode: ModeComposition = {
      kind: "Web",
      sections: {
        service: [
          binding("first", "First", "infrastructure", first),
          binding("second", "Second", "infrastructure", second),
        ],
        controller: [
          binding("api", "Controller", "controller", controller, [
            { kind: "binding", name: "first" },
            { kind: "binding", name: "second" },
          ]),
        ],
      },
    };
    const descriptors = new Map([
      ["First", first],
      ["Second", second],
      ["Controller", controller],
    ]);
    await assertRejects(
      () =>
        startComposition(checked(mode, descriptors), {
          settingValue: () => undefined,
        }),
      Error,
      "Component startup failed",
    );
    assertEquals(log, ["first+", "second+", "first-"]);

    const cleanupFailure = component("infrastructure", [], () => ({
      value: {},
      dispose: () => {
        throw new Error("cleanup failed");
      },
    }));
    const cleanupController = component("controller", [{
      name: "logger",
      type: { kind: "component", category: "infrastructure" },
    }], () => ({ value: {} }));
    const cleanupMode: ModeComposition = {
      kind: "Web",
      sections: {
        service: [
          binding("svc", "Cleanup", "infrastructure", cleanupFailure),
        ],
        controller: [
          binding("api", "Controller", "controller", cleanupController, [{
            kind: "binding",
            name: "svc",
          }]),
        ],
      },
    };
    const started = await startComposition(
      checked(
        cleanupMode,
        new Map([
          ["Cleanup", cleanupFailure],
          ["Controller", cleanupController],
        ]),
      ),
      { settingValue: () => undefined },
    );
    await assertRejects(
      () => started.dispose(),
      AggregateError,
      "Component cleanup failed",
    );
  },
);

Deno.test(
  "req:application-shell-008 checking descriptors never invokes factories",
  () => {
    let invocations = 0;
    const controller = component("controller", [], () => {
      invocations++;
      return { value: {} };
    });
    const mode: ModeComposition = {
      kind: "Web",
      sections: {
        controller: [
          binding("api", "Controller", "controller", controller),
        ],
      },
    };
    assert(checked(mode, new Map([["Controller", controller]])));
    assertEquals(invocations, 0);
  },
);

Deno.test(
  "req:application-shell-008 malformed descriptor argument values are rejected before construction",
  () => {
    const controller = component("controller", [{
      name: "port",
      type: { kind: "number" },
    }], () => ({ value: {} }));
    const mode: ModeComposition = {
      kind: "Web",
      sections: {
        controller: [
          binding("api", "Controller", "controller", controller, [{
            kind: "literal",
            value: "8080",
          }]),
        ],
      },
    };
    const result = checkComposition(
      mode,
      web,
      new Map([
        ["Controller", controller],
      ]),
    );
    assert(!result.ok);
    assert(
      result.problems.some((problem) =>
        problem.code === "INVALID_ARGUMENT_TYPE"
      ),
    );
  },
);
