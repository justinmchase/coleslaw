# Coleslaw

A domain specific language built with [Uffda](https://github.com/justinmchase/uffda).

For now it holds a hello world grammar, `src/hello.uff`. It tokenizes its input
with the Uffda tokenizer, imported from JSR (`jsr:@justinmchase/uffda`, named in
`uffda.jsonc`), and echoes the tokens back.

```sh
uffda run src/hello.uff --input "hello world"
```

The first run downloads the tokenizer into `~/.cache/uffda/jsr` and records its
version in `uffda.lock`. Commit the lockfile.

`uffda compile 'src/**/*.uff'` writes the compiled grammar to `./bin`.
