import type { HostComponentDescriptor } from "../../../src/composition.ts";

let createCalls = 0;

export function getCreateCalls(): number {
  return createCalls;
}

export const Probe: HostComponentDescriptor = {
  kind: "job",
  parameters: [],
  create() {
    createCalls++;
    return { value: { run() {} } };
  },
};
