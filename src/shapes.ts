import type { RawShapeDeclaration, UffdaPatternNode } from "./syntax.ts";

export interface ShapeDefinition {
  readonly name: string;
  readonly pattern: UffdaPatternNode;
}

export type ShapeExpansion =
  | { readonly ok: true; readonly pattern: UffdaPatternNode }
  | { readonly ok: false; readonly message: string };

export function shapeDefinitions(
  declarations: readonly RawShapeDeclaration[],
): ReadonlyMap<string, ShapeDefinition> {
  return new Map(declarations.map((declaration) => [
    declaration.name,
    { name: declaration.name, pattern: declaration.pattern },
  ]));
}

export function expandShapeReferences(
  pattern: UffdaPatternNode,
  shapes: ReadonlyMap<string, ShapeDefinition>,
): ShapeExpansion {
  const expand = (
    current: unknown,
    stack: readonly string[],
  ): { readonly ok: true; readonly value: unknown } | {
    readonly ok: false;
    readonly message: string;
  } => {
    if (Array.isArray(current)) {
      const values: unknown[] = [];
      for (const item of current) {
        const expanded = expand(item, stack);
        if (!expanded.ok) return expanded;
        values.push(expanded.value);
      }
      return { ok: true, value: values };
    }
    if (typeof current !== "object" || current === null) {
      return { ok: true, value: current };
    }
    if (current instanceof RegExp || current instanceof Date) {
      return { ok: true, value: current };
    }

    if (
      Reflect.get(current, "kind") === "resolve" &&
      Reflect.get(current, "targetKind") === "reference"
    ) {
      const name = Reflect.get(current, "name");
      const args = Reflect.get(current, "args");
      if (typeof name !== "string" || !Array.isArray(args) || args.length > 0) {
        return {
          ok: false,
          message: "Named shapes do not accept pattern arguments",
        };
      }
      const definition = shapes.get(name);
      if (definition === undefined) {
        return {
          ok: false,
          message: `Unknown named shape ${name}`,
        };
      }
      if (stack.includes(name)) {
        return {
          ok: false,
          message: `Named shape cycle: ${[...stack, name].join(" -> ")}`,
        };
      }
      return expand(definition.pattern, [...stack, name]);
    }

    const value: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string") continue;
      const expanded = expand(Reflect.get(current, key), stack);
      if (!expanded.ok) return expanded;
      value[key] = expanded.value;
    }
    return { ok: true, value };
  };

  const result = expand(pattern, []);
  return result.ok
    ? { ok: true, pattern: result.value as UffdaPatternNode }
    : result;
}

export function shapeDefinitionsFromDeclarations(
  declarations: readonly unknown[],
): ReadonlyMap<string, ShapeDefinition> {
  return shapeDefinitions(
    declarations.filter((declaration): declaration is RawShapeDeclaration =>
      typeof declaration === "object" && declaration !== null &&
      Reflect.get(declaration, "kind") === "shape"
    ),
  );
}
