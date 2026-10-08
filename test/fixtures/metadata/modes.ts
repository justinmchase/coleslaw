import { BUILTIN_MODES } from "../../../src/application.ts";

export const Web = BUILTIN_MODES.Web;
export const Malformed = { kind: "Web" };
export const Forged = {
  kind: "Web",
  traversal: "full",
  entryPoint: "controller",
  run() {},
};
