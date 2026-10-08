# Config

This chapter defines config: the declaration of a program's settings, where
their values come from, how those values are named in each source, and how input
becomes config. Terms are defined in the [glossary](./glossary.spec.md).

## Conventions

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted
as described in RFC 2119 and RFC 8174 when, and only when, they appear in all
capitals.

## The config declaration

- A program MUST declare its config: a tree of named settings, each with a
  shape.
- A config declaration MUST describe an object pattern. Each setting MUST use
  `identifier: Pattern;`, where `Pattern` is any Uffda pattern satisfying
  Coleslaw's data and purity constraints, including optionality, intersections,
  unions, and projections. Parentheses MAY group a pattern but MUST NOT be
  required around every setting pattern.
- A setting MAY give a default, or be optional, through its shape (see
  [patterns as types](./patterns-as-types.spec.md#the-value-a-shape-gives)). A
  setting with neither is required.
- A setting MAY be marked secret. A secret's value MUST NOT appear in any
  diagnostic, log, or error, including one reporting that it failed its shape.
- Config MUST accept only data (see
  [patterns as types](./patterns-as-types.spec.md#data)).
- Config MUST NOT depend on any other declaration of the program.
- Common patterns and pure conversion functions provided by the language MAY be
  used without introducing a dependency on application declarations.

### Text matching and projection

```text
export config ShellSettings {
    githubAppId: Number? -> (toint (default _ 372035));
    secret githubPrivateKey: String;
    githubWebhookPath: String? -> (default _ "/github_webhook");
    secret githubWebhookSecret: String?;
    mongoConnectionString: String;
}
```

Here `String` matches source text and `Number` denotes a numeric-text pattern,
such as `string & [Digit+]` with a resolved `Digit` pattern. `Number` in this
example MUST match the string, not silently convert it to a numeric value.
`toint` performs the explicit conversion after a successful match; `_` is the
matched value passed to the projection.

- Common text patterns MUST specify the exact text they accept. The illustrated
  digit-only pattern MUST NOT imply support for signs, fractions, exponents,
  whitespace, or empty text.
- `default` in these examples MUST supply its fallback only for an absent value.
  A present value that fails the pattern or conversion MUST be reported as
  invalid, not replaced with the default.
- The projected value MUST become the setting's config value. It MUST NOT be
  rematched against the source-text pattern: `githubAppId` above becomes an
  integer, not a string.
- Projections MUST be pure and produce only data. Conversion failures MUST be
  surfaced explicitly with secret-safe diagnostics; coercion MUST NOT be
  performed implicitly by the source-merging layer.

## Sources

A process's input comes from two sources built into Coleslaw. When both supply a
setting, the command line wins over the environment.

Programs MAY additionally declare positional command-line bindings under
[application shell](./application-shell.spec.md#settings-and-selection). Named
flags take precedence over positionals; both precede the environment.

- **Command line**: flags, such as `--database.url postgres://...`.
- **Environment**: variables, such as `DATABASE__URL=postgres://...`.

- Precedence MUST be decided per setting: a setting the command line does not
  supply MAY still come from the environment while another comes from the
  command line.

## Extending sources

Other sources, such as a `.env` file, are not built in. They are added by
extensions (see the planned `extensions` chapter), so the config layer stays
small and each program chooses the sources it wants.

- The config layer MUST allow an extension to add a source.
- An added source MUST give values by setting, as strings, named as one of the
  built-in sources names them or by a convention the extension defines.
- An added source MUST rank below the environment unless the extension declares
  otherwise, so the command line and the environment always win by default.
- An added source MUST NOT depend on config the process has not yet parsed,
  except settings it declares for itself, such as the path of a file it reads,
  which come from the built-in sources.
- For example, an extension that reads a `.env` file in the working directory,
  when one is present, gives environment variables that rank below the real
  environment, and MAY declare its own setting, such as `--env-file`, to read a
  different file.

## Names in each source

Each setting has a path in the config tree: its segments, each a camel case
name, such as `database.url` (a `url` setting inside `database`) or
`databaseUrl` (one setting). Its name in each source follows from its path by
convention. Each convention separates the words within a segment differently
from the segments themselves, so that a name maps back to exactly one path.

- A setting's segment names MUST be camel case: a lowercase first word, each
  later word capitalized, with no separators (`databaseUrl`, `apiKey`).
- A setting's environment variable MUST be its path in upper snake case: words
  within a segment joined by `_`, and segments joined by `__`. `databaseUrl` is
  `DATABASE_URL`; `database.url` is `DATABASE__URL`; `payments.apiKey` is
  `PAYMENTS__API_KEY`.
- A setting's flag MUST be its path in kebab case: words within a segment joined
  by `-`, and segments joined by `.`. `databaseUrl` is `--database-url`;
  `database.url` is `--database.url`; `payments.apiKey` is `--payments.api-key`.
- A setting MAY declare a different name for any source, which replaces the
  conventional one for that source only.
- Two settings MUST NOT have the same name in the same source. A program whose
  overrides collide with each other or with a conventional name MUST be a
  compile error.

## Parsing input into config

- The runtime MUST first map supplied source names to declared setting paths and
  merge their raw values according to per-setting precedence. Merging MUST NOT
  execute patterns, projections, defaults, or coercions.
- The resulting input MUST be an object with the config declaration's nested
  structure. A missing setting MUST remain absent; the runtime MUST NOT invent
  an empty string, null, or a typed default.
- Values from every source arrive as strings. A setting's shape MUST parse them:
  for example, a number setting's shape matches a string of digits and projects
  the number (see
  [patterns as types](./patterns-as-types.spec.md#the-value-a-shape-gives)).
- Only the winning raw value for a setting MUST be matched and projected.
  Invalid higher-precedence input MUST NOT fall back to a lower-precedence
  source or a pattern default.
- After every setting has been taken from its sources, the whole config MUST
  match the config declaration. Input that does not MUST stop the process before
  anything is constructed, with a diagnostic naming every setting that failed,
  its source, and what was expected, but never a secret's value.
- Matching and projecting the config object MAY be staged for mode selection:
  selector settings are resolved first, then settings reached by the selected
  mode. Unselected-mode-only settings MUST NOT become required merely because
  their values are included in the merged input. The resolved config object MUST
  contain canonical projected values for the reached settings before any
  component is constructed.
- Input that names no setting, such as an unknown flag, MUST stop the process
  the same way. An environment variable that names no setting is ignored, since
  the environment holds variables for other programs too.

## Built-in settings

Coleslaw declares some settings itself, in every program:

- `mode`: the mode to run (see [modes](./modes.spec.md#selecting-a-mode)).
- `job`: in a job mode, the job to run, and that job's arguments under a segment
  named for it (see [jobs](./jobs.spec.md#selecting-a-job)).
- `commandAttempts`: the retry bound for conflicted commands (see
  [runtime](./runtime.spec.md#the-retry-bound)).
- query policy overrides: optional per-setting overrides of Coleslaw and program
  defaults, before endpoint read-limit overrides (see
  [queries](./queries.spec.md#defaults-and-overrides)). These MUST NOT change a
  mode's traversal capability.
- the implementation and settings of each service, queue, and external event
  source the selected mode reaches (see [startup](./startup.spec.md#services),
  [queues](./queues.spec.md#implementations), and
  [reactors](./reactors.spec.md#external-events)).

## Open questions

- **Common parsing catalog.** Exact exported names and accepted text for common
  patterns such as `Number`, `String`, and `Digit`, and the conversion ranges
  and failure contracts of functions such as `toint`. The examples specify their
  intended roles, not an already released Uffda API.
- **Structured settings.** Every source gives strings, so a setting holding a
  list or an object must be parsed from one, such as JSON in a variable. Whether
  Coleslaw defines a standard way to do so.
- **Secrets from a store.** Whether a setting's value may come from a secret
  store, such as a vault, as a fourth source, or only through the environment.
