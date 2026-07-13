import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/dashboard/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
  // Peer / optional deps are provided by the consumer — never bundle them.
  external: [
    "bullmq",
    "zod",
    "@bull-board/api",
    "@bull-board/express",
    "express",
  ],
});
