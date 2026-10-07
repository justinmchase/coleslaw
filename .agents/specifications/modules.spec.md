# Modules

This chapter defines how a program is divided: modules and their imports and
exports, contexts and the boundary between them, and packages. Terms are defined
in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## Modules

A module is one Coleslaw source file. Every structural part of a program, such
as an aggregate, a projection, a manager, a context, or a mode, is a declaration
of its own kind in some module.

- A module MUST consist of imports, then declarations.
- A declaration's name MUST be unique within its module, including names the
  module imports.
- A file's name and its place in the directory tree MUST NOT change what it
  declares or who may import it. Only declarations, imports, and exports do.

## Imports and exports

Coleslaw uses Uffda's import and export syntax and Uffda's module resolution
(see the overview's [compilation](./overview.spec.md#compilation)).

- An import MUST name its module and each declaration it takes from it, such as
  `import "./catalog/context.clsw" Catalog;`. Importing a module whole, or every
  name it exports, MUST NOT be allowed, so every dependency is visible where it
  is used.
- A module MUST export a declaration explicitly, either where it is declared
  (`export context Catalog { ... }`) or by name (`export Catalog;`). A module
  MAY export a name it imported.
- An import of a name its module does not export MUST be a compile error, naming
  the module and the name.
- A module specifier MUST resolve as Uffda resolves it: relative to the
  importing module, through the project's import map, or from a package (see
  [packages](#packages)).

## Contexts

A context is a bounded context: a part of the program with its own model of the
business, in which each term has one meaning. A large application has several.
In an online store, a catalog context's `Product` holds a name, description, and
photos; an inventory context's `Product` holds stock counts per warehouse; and a
shipping context's `Product` holds weight and dimensions. Each is a separate
aggregate, sharing only the product's identity, so that no context's rules
depend on another's model.

Contexts integrate through what they export, mainly events: when the catalog
records `ProductDiscontinued`, a reactor in inventory reacts by sending its own
`Product` a command to stop restocking. Neither reaches into the other's
aggregates.

### Declaring a context

- A context MUST be declared with `context` and a name, and a body listing its
  members, such as `export context Catalog { ... }`.
- A member MUST be a declaration written in the body or the name of one the
  module imports, so a context MAY gather declarations from any modules,
  wherever they are.
- A member MUST be an aggregate, a projection, a manager, a reactor, a
  controller, a consumer, or a job. These are owned: each MUST be a member of at
  most one context in a program.
- Shapes, funcs, and service declarations hold no state and are not owned.
  Contexts MAY use them freely, and a body MAY list them so that the context can
  export them.
- A context's name MUST be unique in the program. An aggregate kind is
  identified by its context's name and its own, so two contexts MAY each have an
  aggregate named `Product`, and their stored states and events never mix.

### What a context exports

- A member listed with `export` in the body is exported by the context, such as
  `export ProductListing;`, and an event is exported by its aggregate and name,
  such as `export Product.ProductDiscontinued;`.
- A context MAY export events, projections, shapes, and funcs, which other
  contexts use, and controllers, consumers, jobs, and reactors, which modes run.
- A context MUST NOT export aggregates, managers, or services. Its aggregates
  change only through its own managers and reactors, and its managers are
  reached only through its own entry points.

### The boundary

- A member of a context MAY use any other member of the same context, and
  anything not owned.
- A declaration MUST use an owned declaration of another context, or an event of
  one of its aggregates, only through that context and only if that context
  exports it, such as `Catalog.ProductDiscontinued` after importing `Catalog`.
  Using it any other way, such as by importing it from the module that declares
  it, MUST be a compile error naming both contexts and the declaration.
- A mode MUST reach the entry points and reactors of a context through that
  context, such as `Catalog.CatalogApi`.
- Owned declarations that are a member of no context belong to the program's
  default context, which has no name and exports nothing. A program that
  declares no contexts is entirely in its default context, so a small program
  needs no context declarations.

## Project file

- A Coleslaw project's project file MUST be named `clsw.jsonc`, at the project's
  root. It MUST have the shape of Uffda's project file (`uffda.jsonc`): its
  import map, its exports, and its output directory.
- A project's lockfile MUST be `clsw.lock`, beside its project file, with the
  shape of Uffda's lockfile.
- A Coleslaw project MUST NOT need a `uffda.jsonc`. Coleslaw's tools, and
  Uffda's module resolution when it runs a Coleslaw program, MUST read
  `clsw.jsonc` instead (see the overview's
  [Uffda prerequisites](./overview.spec.md#uffda-prerequisites)).

## Packages

- A package MUST be published, versioned, and imported as Uffda's packages are,
  with its exports declared in its `clsw.jsonc` (see the overview's
  [Uffda prerequisites](./overview.spec.md#uffda-prerequisites)).
- A package MAY export contexts. A program MAY import a context from a package,
  such as `import "@example/product" Catalog;`, and use it as one of its own:
  its members become part of the program, its exports are used through it, and a
  mode MAY run its entry points and reactors.
- A package's context MUST be bound by the same boundary as the program's own.
  The program MUST NOT use the context's unexported members.

## Conventions for files

Coleslaw does not enforce any layout. These are recommendations for tools and
documentation.

- A context SHOULD live in a directory of its own, named after it in kebab case,
  with the context declared in `context.clsw` at its root, such as
  `catalog/context.clsw`.
- The modes SHOULD be declared at the root of the project, outside every
  context's directory.

## Open questions

- **Name conflicts.** Whether an import MAY rename what it takes, so that a
  program can use two packages' contexts that have the same name.
- **Nesting.** Whether a context MAY contain another context.
- **Cycles.** Whether modules MAY import each other in a cycle, and whether
  contexts MAY export events to each other in a cycle.
- **Shared kernels.** Whether two contexts MAY share an owned declaration, as
  domain-driven design's shared kernel does, or must always integrate through
  exports.
