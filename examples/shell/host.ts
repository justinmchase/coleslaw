import type { HostComponentDescriptor } from "../../src/composition.ts";

export const ExampleJob: HostComponentDescriptor = {
  kind: "job",
  parameters: [],
  create() {
    return {
      value: {
        run() {
          console.log(
            "Example test adapter ran; it contains no domain business logic.",
          );
        },
      },
    };
  },
};
