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
- A setting MAY give a default, or be optional, through its shape (see
  [patterns as types](./patterns-as-types.spec.md#the-value-a-shape-gives)). A
  setting with neither is required.
- A setting MAY be marked secret. A secret's value MUST NOT appear in any
  diagnostic, log, or error, including one reporting that it failed its shape.
- Config MUST accept only data (see
  [patterns as types](./patterns-as-types.spec.md#data)).
- Config MUST NOT depend on any other declaration of the program.

## Sources

A process's input comes from three sources. When more than one supplies a
setting, the command line wins over the environment, and the environment over
the `.env` file.

- **Command line**: flags, such as `--database-url postgres://...`.
- **Environment**: variables, such as `DATABASE_URL=postgres://...`.
- **`.env` file**: a file in the standard format of one `NAME=value` line per
  variable, whose names are environment variable names. By default it is the
  file `.env` in the working directory, read when it is present; without one
  there is no file. The built-in setting `env-file` MAY name a different file.

- Precedence MUST be decided per setting: a setting the command line does not
  supply MAY still come from the environment while another comes from the
  command line.

## Names in each source

Each setting has a path in the config tree, such as `database.url`. Its name in
each source follows from its path by convention.

- A setting's flag MUST be its path in kebab case, with segments joined by `-`
  (`database.url` is `--database-url`).
- A setting's environment variable MUST be its path in upper snake case, with
  segments joined by `_` (`database.url` is `DATABASE_URL`).
- A setting's name in the `.env` file MUST be its environment variable.
- A setting MAY declare a different name for any source, which replaces the
  conventional one for that source only.
- Two settings MUST NOT have the same name in the same source. A program whose
  conventions or overrides collide MUST be a compile error.

## Parsing input into config

- Values from every source arrive as strings. A setting's shape MUST parse them:
  for example, a number setting's shape matches a string of digits and projects
  the number (see
  [patterns as types](./patterns-as-types.spec.md#the-value-a-shape-gives)).
- After every setting has been taken from its sources, the whole config MUST
  match the config declaration. Input that does not MUST stop the process before
  anything is constructed, with a diagnostic naming every setting that failed,
  its source, and what was expected, but never a secret's value.
- Input that names no setting, such as an unknown flag, MUST stop the process
  the same way. An environment variable that names no setting is ignored, since
  the environment holds variables for other programs too, and so is a variable
  in the `.env` file that names no setting.

## Built-in settings

Coleslaw declares some settings itself, in every program:

- `mode`: the mode to run (see [modes](./modes.spec.md#selecting-a-mode)).
- `env-file`: the path of the `.env` file to read instead of `.env` in the
  working directory, given by `--env-file` or `ENV_FILE`. It cannot come from a
  `.env` file. A file it names that does not exist MUST stop the process with a
  diagnostic, unlike the default file, whose absence is normal.
- the implementation and settings of each service the selected mode reaches (see
  [startup](./startup.spec.md#services)).

## Open questions

- **Structured settings.** Every source gives strings, so a setting holding a
  list or an object must be parsed from one, such as JSON in a variable. Whether
  Coleslaw defines a standard way to do so.
- **Secrets from a store.** Whether a setting's value may come from a secret
  store, such as a vault, as a fourth source, or only through the environment.
