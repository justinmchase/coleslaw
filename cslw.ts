import { executeCli } from "./src/cli.ts";

Deno.exitCode = await executeCli(Deno.args);
