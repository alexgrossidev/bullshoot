// Compile-time proof that the typed surface rejects misuse.
// `npm run check-types:examples` must pass — every @ts-expect-error below must
// actually be an error, or tsc fails the build.

import { z } from "zod";
import { defineJob, createQueueClient } from "../src/index";

const ping = defineJob({
  name: "ping",
  schema: z.object({ url: z.string() }),
  handler: async ({ data }) => {
    const _url: string = data.url; // data is typed
    void _url;
  },
});

const queue = createQueueClient({
  redis: { url: "redis://localhost:6379" },
  jobs: [ping],
});

// ✅ valid
void queue.enqueue("ping", { url: "https://a.com" });

// ❌ unknown job name
// @ts-expect-error - "pong" is not a registered job
void queue.enqueue("pong", { url: "https://a.com" });

// ❌ wrong payload shape
// @ts-expect-error - missing required `url`
void queue.enqueue("ping", { path: "/x" });

// ❌ wrong field type
// @ts-expect-error - url must be a string
void queue.enqueue("ping", { url: 123 });

// ❌ startWorkers only accepts known names
// @ts-expect-error - "nope" is not a registered job
queue.startWorkers({ only: ["nope"] });
