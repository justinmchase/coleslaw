export type BuiltInModeKind = "Web" | "Worker" | "Job" | "Events";
export type ComponentCategory =
  | "service"
  | "repository"
  | "manager"
  | "controller"
  | "job"
  | "consumer"
  | "reactor"
  | "infrastructure"
  | "projection";

export interface HostValueType {
  readonly kind: "string" | "number" | "boolean" | "object" | "component";
  readonly category?: ComponentCategory;
}

export interface HostParameter {
  readonly name: string;
  readonly type: HostValueType;
}

export interface ComponentResource<T = unknown> {
  readonly value: T;
  dispose?(): void | Promise<void>;
}

export interface ModeRunOptions {
  readonly signal?: AbortSignal;
  readonly onListen?: (address: { hostname: string; port: number }) => void;
}

export interface HostComponentDescriptor<T = unknown> {
  readonly kind: ComponentCategory;
  readonly parameters: readonly HostParameter[];
  create(arguments_: readonly unknown[]):
    | ComponentResource<T>
    | Promise<
      ComponentResource<T>
    >;
}

export interface HostModeDescriptor {
  readonly kind: BuiltInModeKind | string;
  readonly traversal: "limited" | "full";
  readonly entryPoint: "controller" | "consumer" | "job" | "reactor";
  run(
    entryPoints: readonly unknown[],
    arguments_: readonly unknown[],
    options?: ModeRunOptions,
  ): void | Promise<void>;
}

export type CompositionArgument =
  | { readonly kind: "literal"; readonly value: unknown }
  | { readonly kind: "binding"; readonly name: string }
  | { readonly kind: "setting"; readonly path: readonly string[] };

export interface ComponentBinding {
  readonly name: string;
  readonly component: string;
  readonly category: ComponentCategory;
  readonly descriptor: HostComponentDescriptor;
  readonly arguments: readonly CompositionArgument[];
}

export interface ModeComposition {
  readonly kind: BuiltInModeKind | string;
  readonly sections: Readonly<
    Partial<Record<ComponentCategory, readonly ComponentBinding[]>>
  >;
}

export interface CompositionProblem {
  readonly code:
    | "UNKNOWN_BINDING"
    | "DUPLICATE_BINDING"
    | "INVALID_SECTION"
    | "INVALID_DESCRIPTOR"
    | "INVALID_ARGUMENT_COUNT"
    | "INVALID_ARGUMENT_TYPE"
    | "DEPENDENCY_CYCLE";
  readonly message: string;
}

export type CompositionCheck =
  | { readonly ok: true; readonly checked: CheckedComposition }
  | { readonly ok: false; readonly problems: readonly CompositionProblem[] };

export interface CheckedComposition {
  readonly mode: ModeComposition;
  readonly modeDescriptor: HostModeDescriptor;
  readonly bindings: readonly ComponentBinding[];
  readonly roots: readonly ComponentBinding[];
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
}

const MODE_SECTIONS: Readonly<
  Record<string, { section: ComponentCategory; entry: ComponentCategory }>
> = {
  Web: { section: "controller", entry: "controller" },
  Worker: { section: "consumer", entry: "consumer" },
  Job: { section: "job", entry: "job" },
  Events: { section: "reactor", entry: "reactor" },
};

const COMPONENT_CATEGORIES = new Set<ComponentCategory>([
  "service",
  "repository",
  "manager",
  "controller",
  "job",
  "consumer",
  "reactor",
  "infrastructure",
  "projection",
]);

const VALUE_TYPES = new Set<HostValueType["kind"]>([
  "string",
  "number",
  "boolean",
  "object",
  "component",
]);

export function isHostComponentDescriptor(
  value: unknown,
): value is HostComponentDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HostComponentDescriptor>;
  if (
    candidate.kind === undefined ||
    !COMPONENT_CATEGORIES.has(candidate.kind) ||
    typeof candidate.create !== "function" ||
    !Array.isArray(candidate.parameters)
  ) {
    return false;
  }
  const parameterNames = new Set<string>();
  for (const parameter of candidate.parameters) {
    if (
      typeof parameter !== "object" || parameter === null ||
      typeof parameter.name !== "string" || parameter.name.length === 0 ||
      parameterNames.has(parameter.name) ||
      typeof parameter.type !== "object" || parameter.type === null ||
      !VALUE_TYPES.has(parameter.type.kind)
    ) {
      return false;
    }
    if (
      parameter.type.kind === "component" &&
      (typeof parameter.type.category !== "string" ||
        !COMPONENT_CATEGORIES.has(parameter.type.category))
    ) {
      return false;
    }
    if (
      parameter.type.kind !== "component" &&
      parameter.type.category !== undefined
    ) {
      return false;
    }
    parameterNames.add(parameter.name);
  }
  return true;
}

export function isHostModeDescriptor(
  value: unknown,
): value is HostModeDescriptor {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HostModeDescriptor>;
  return typeof candidate.kind === "string" &&
    (candidate.traversal === "limited" || candidate.traversal === "full") &&
    typeof candidate.entryPoint === "string" &&
    ["controller", "consumer", "job", "reactor"].includes(
      candidate.entryPoint,
    ) &&
    typeof candidate.run === "function";
}

function valueMatches(value: unknown, type: HostValueType): boolean {
  switch (type.kind) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return typeof value === "object" && value !== null &&
        !Array.isArray(value);
    case "component":
      return false;
  }
}

function acceptsComponent(
  actual: ComponentCategory,
  expected: ComponentCategory | undefined,
): boolean {
  return expected !== undefined && actual === expected;
}

export function checkComposition(
  mode: ModeComposition,
  modeDescriptor: HostModeDescriptor,
  importedDescriptors: ReadonlyMap<string, HostComponentDescriptor>,
): CompositionCheck {
  const problems: CompositionProblem[] = [];
  if (!isHostModeDescriptor(modeDescriptor)) {
    problems.push({
      code: "INVALID_DESCRIPTOR",
      message: `Invalid mode descriptor for ${mode.kind}`,
    });
  }
  const builtinShape = MODE_SECTIONS[mode.kind];
  const modeShape = builtinShape ?? {
    section: modeDescriptor.entryPoint,
    entry: modeDescriptor.entryPoint,
  };
  if (modeDescriptor.kind !== mode.kind) {
    problems.push({
      code: "INVALID_DESCRIPTOR",
      message:
        `Mode descriptor kind ${modeDescriptor.kind} does not match ${mode.kind}`,
    });
  }
  if (
    modeDescriptor.entryPoint !== modeShape.entry
  ) {
    problems.push({
      code: "INVALID_DESCRIPTOR",
      message: `${mode.kind} mode requires ${modeShape.entry} entry points`,
    });
  }
  if (
    builtinShape &&
    modeDescriptor.traversal !== (mode.kind === "Web" ? "limited" : "full")
  ) {
    problems.push({
      code: "INVALID_DESCRIPTOR",
      message: `${mode.kind} mode has fixed collection traversal capability`,
    });
  }

  const bindings = Object.values(mode.sections).flatMap((section) =>
    section ?? []
  );
  const byName = new Map<string, ComponentBinding>();
  for (const binding of bindings) {
    if (byName.has(binding.name)) {
      problems.push({
        code: "DUPLICATE_BINDING",
        message: `Duplicate component binding ${binding.name}`,
      });
      continue;
    }
    byName.set(binding.name, binding);
    const imported = importedDescriptors.get(binding.component);
    if (!imported) {
      problems.push({
        code: "UNKNOWN_BINDING",
        message: `No imported descriptor for ${binding.component}`,
      });
    } else if (imported !== binding.descriptor) {
      problems.push({
        code: "INVALID_DESCRIPTOR",
        message: `Binding ${binding.name} does not use its imported descriptor`,
      });
    }
    const validDescriptor = isHostComponentDescriptor(binding.descriptor);
    if (!validDescriptor) {
      problems.push({
        code: "INVALID_DESCRIPTOR",
        message: `Invalid host descriptor for ${binding.component}`,
      });
      continue;
    }
    if (binding.descriptor.kind !== binding.category) {
      problems.push({
        code: "INVALID_DESCRIPTOR",
        message:
          `${binding.name} is declared as ${binding.category} but its descriptor is ${binding.descriptor.kind}`,
      });
    }
    if (binding.category === "controller") {
      for (const parameter of binding.descriptor.parameters) {
        if (
          parameter.type.kind === "component" &&
          parameter.type.category === "service"
        ) {
          problems.push({
            code: "INVALID_ARGUMENT_TYPE",
            message:
              `Controller ${binding.name} cannot receive general service capability ${parameter.name}`,
          });
        }
      }
    }
  }

  const entrySection = modeShape?.section;
  for (const [sectionName, sectionBindings] of Object.entries(mode.sections)) {
    for (const binding of sectionBindings ?? []) {
      if (
        binding.category !== sectionName &&
        !(binding.category === "infrastructure" && sectionName === "service")
      ) {
        problems.push({
          code: "INVALID_SECTION",
          message:
            `Binding ${binding.name} of kind ${binding.category} is in ${sectionName}`,
        });
      }
      if (
        ["controller", "consumer", "job", "reactor"].includes(sectionName) &&
        sectionName !== entrySection
      ) {
        problems.push({
          code: "INVALID_SECTION",
          message:
            `${mode.kind} mode cannot declare ${sectionName} entry points`,
        });
      }
    }
  }

  const dependencies = new Map<string, string[]>();
  for (const binding of bindings) {
    const descriptor = binding.descriptor;
    if (descriptor.parameters.length !== binding.arguments.length) {
      problems.push({
        code: "INVALID_ARGUMENT_COUNT",
        message:
          `${binding.name} expects ${descriptor.parameters.length} arguments but received ${binding.arguments.length}`,
      });
      continue;
    }
    const refs: string[] = [];
    for (let index = 0; index < descriptor.parameters.length; index++) {
      const expected = descriptor.parameters[index].type;
      const argument = binding.arguments[index];
      if (argument.kind === "binding") {
        refs.push(argument.name);
        const dependency = byName.get(argument.name);
        if (!dependency) {
          problems.push({
            code: "UNKNOWN_BINDING",
            message:
              `${binding.name} refers to missing binding ${argument.name}`,
          });
        } else if (
          expected.kind !== "component" ||
          !acceptsComponent(dependency.category, expected.category)
        ) {
          problems.push({
            code: "INVALID_ARGUMENT_TYPE",
            message: `${binding.name}.${
              descriptor.parameters[index].name
            } does not accept ${dependency.category}`,
          });
        }
      } else if (argument.kind === "literal") {
        if (
          expected.kind === "component" ||
          !valueMatches(argument.value, expected)
        ) {
          problems.push({
            code: "INVALID_ARGUMENT_TYPE",
            message: `${binding.name}.${
              descriptor.parameters[index].name
            } has an incompatible literal`,
          });
        }
      } else {
        refs.push(`$setting:${argument.path.join(".")}`);
      }
    }
    dependencies.set(binding.name, refs);
  }

  const roots = (mode.sections[entrySection ?? "controller"] ?? []).slice();
  if (roots.some((root) => root.category !== modeDescriptor.entryPoint)) {
    problems.push({
      code: "INVALID_DESCRIPTOR",
      message:
        `${mode.kind} requires ${modeDescriptor.entryPoint} entry points`,
    });
  }
  if (roots.length === 0) {
    problems.push({
      code: "INVALID_SECTION",
      message:
        `${mode.kind} mode requires at least one ${modeDescriptor.entryPoint} entry point`,
    });
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string): void => {
    if (visiting.has(name)) {
      problems.push({
        code: "DEPENDENCY_CYCLE",
        message: `Dependency cycle includes ${name}`,
      });
      return;
    }
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of dependencies.get(name) ?? []) {
      if (!dependency.startsWith("$setting:")) visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
  };
  for (const binding of bindings) visit(binding.name);

  if (problems.length > 0) return { ok: false, problems };

  const orderedBindings = bindings.slice();
  const declarationOrder = new Map(
    orderedBindings.map((binding, index) => [binding.name, index]),
  );
  const sortedDependencies = new Map(
    [...dependencies].map(([name, refs]) => [
      name,
      refs.toSorted((a, b) =>
        (declarationOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (declarationOrder.get(b) ?? Number.MAX_SAFE_INTEGER)
      ),
    ]),
  );
  return {
    ok: true,
    checked: {
      mode,
      modeDescriptor,
      bindings: orderedBindings,
      roots,
      dependencies: sortedDependencies,
    },
  };
}

export interface CompositionRunOptions {
  readonly settingValue: (path: readonly string[]) => unknown;
}

export interface StartedComposition {
  readonly rootValues: readonly unknown[];
  run(
    arguments_?: readonly unknown[],
    options?: ModeRunOptions,
  ): Promise<void>;
  dispose(): Promise<void>;
}

export async function startComposition(
  checked: CheckedComposition,
  options: CompositionRunOptions,
): Promise<StartedComposition> {
  const bindingByName = new Map(
    checked.bindings.map((binding) => [binding.name, binding]),
  );
  const constructionOrder: ComponentBinding[] = [];
  const seen = new Set<string>();
  const visit = (binding: ComponentBinding): void => {
    if (seen.has(binding.name)) return;
    seen.add(binding.name);
    for (const dependencyName of checked.dependencies.get(binding.name) ?? []) {
      if (dependencyName.startsWith("$setting:")) continue;
      const dependency = bindingByName.get(dependencyName);
      if (dependency) visit(dependency);
    }
    constructionOrder.push(binding);
  };
  for (const root of checked.roots) visit(root);

  const resources = new Map<string, ComponentResource>();
  const constructed: ComponentResource[] = [];
  const dispose = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const resource of constructed.toReversed()) {
      try {
        await resource.dispose?.();
      } catch (error) {
        failures.push(error);
      }
    }
    constructed.length = 0;
    resources.clear();
    if (failures.length > 0) {
      throw new AggregateError(failures, "Component cleanup failed");
    }
  };

  try {
    for (const binding of constructionOrder) {
      const values = binding.arguments.map((argument) => {
        switch (argument.kind) {
          case "literal":
            return argument.value;
          case "binding":
            return resources.get(argument.name)?.value;
          case "setting":
            return options.settingValue(argument.path);
        }
      });
      const resource = await binding.descriptor.create(values);
      resources.set(binding.name, resource);
      constructed.push(resource);
    }
  } catch (error) {
    try {
      await dispose();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Component startup and cleanup failed",
      );
    }
    throw new Error("Component startup failed", { cause: error });
  }

  let disposed = false;
  return {
    rootValues: checked.roots.map((root) => resources.get(root.name)?.value),
    async run(arguments_ = [], runOptions) {
      if (disposed) throw new Error("Composition has already been disposed");
      await checked.modeDescriptor.run(
        checked.roots.map((root) => resources.get(root.name)?.value),
        arguments_,
        runOptions,
      );
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      await dispose();
    },
  };
}
