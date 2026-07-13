import { z } from "zod";
import { defineJob, createQueueClient } from "../src/index";

// ─── 1. Declare jobs in your own code — never edit the library ────────────────

const sendEmail = defineJob({
  name: "email.send",
  schema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  handler: async ({ data, logger }) => {
    // `data` is fully typed: { to: string; subject: string; body: string }
    logger.info({ to: data.to }, "sending email");
  },
  options: { attempts: 5, concurrency: 10 },
});

const resizeImage = defineJob({
  name: "image.resize",
  schema: z.object({ url: z.string().url(), width: z.number().int() }),
  handler: async ({ data }) => {
    console.log(`resizing ${data.url} to ${data.width}px`);
  },
});

// ─── 2. Wire them into one client ─────────────────────────────────────────────

const queue = createQueueClient({
  redis: { host: "127.0.0.1", port: 6379 },
  jobs: [sendEmail, resizeImage],
  defaults: { removeOnComplete: { count: 1000 } },
});

// ─── 3a. Producer side — enqueue with full type safety ────────────────────────

async function producer() {
  await queue.enqueue("email.send", {
    to: "user@example.com",
    subject: "Welcome",
    body: "Thanks for signing up.",
  });

  await queue.scheduleOnce(
    "image.resize",
    { url: "https://cdn.example.com/a.png", width: 320 },
    { delay: 5_000 },
  );

  await queue.schedule(
    "image.resize",
    { url: "https://cdn.example.com/nightly.png", width: 64 },
    { repeat: { cron: "0 3 * * *" } },
  );
}

// ─── 3b. Consumer side — run the handlers ─────────────────────────────────────

function worker() {
  queue.startWorkers();
}

void producer;
void worker;
