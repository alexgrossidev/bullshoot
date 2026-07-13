# bullshoot

[![CI](https://github.com/alegrossi2001/bullshoot/actions/workflows/ci.yml/badge.svg)](https://github.com/alegrossi2001/bullshoot/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@alegrossi2001/bullshoot.svg)](https://www.npmjs.com/package/@alegrossi2001/bullshoot)
[![license](https://img.shields.io/npm/l/@alegrossi2001/bullshoot.svg)](./LICENSE)

**Type-safe BullMQ infrastructure with runtime validation and almost zero boilerplate.**

BullMQ is an excellent queue system, but most applications end up rebuilding the same infrastructure around it:

* Queue registration
* Worker wiring
* Payload validation
* Type-safe producers
* Scheduling
* Logging
* Dashboard setup

**bullshoot** packages those patterns into a single client while staying completely compatible with BullMQ. You define your jobs inside your own application, and bullshoot handles the repetitive plumbing.

```bash
npm install @alegrossi2001/bullshoot bullmq zod
```

## Why bullshoot?

* 🧩 **Jobs belong to your application** — define them in your own codebase. Never modify the library.
* 🔒 **End-to-end type safety** — only valid job names and payloads compile.
* ✅ **Runtime validation** — every payload is validated before your handler executes.
* 🚀 **Minimal setup** — producers and workers share the same configuration.
* 🪶 **Minimal dependencies** — no logging framework, environment loader or configuration magic.
* 📊 **Optional dashboard** — Bull Board integration in one import.
* 🔓 **Escape hatches included** — access the underlying BullMQ objects whenever needed.

---

# How it works

```
               enqueue()

                   │

          createQueueClient()

                   │

              Bullshoot

                   │

               BullMQ

                   │

                Redis

                   │

        startWorkers()

                   │

            Your handlers
```

You define jobs once, create a single client, and deploy it wherever you need.

* API servers only call `enqueue()`
* Worker processes only call `startWorkers()`
* Both share exactly the same configuration

---

# Quick Start

## 1. Define your jobs

```ts
import { z } from "zod";
import { defineJob } from "@alegrossi2001/bullshoot";

export const sendEmail = defineJob({
  name: "email.send",

  schema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),

  handler: async ({ data, logger }) => {
    logger.info({ to: data.to }, "Sending email");

    await mailer.send(data);
  },

  options: {
    attempts: 5,
    concurrency: 10,
  },
});

export const resizeImage = defineJob({
  name: "image.resize",

  schema: z.object({
    url: z.string().url(),
    width: z.number().int(),
  }),

  handler: async ({ data }) => {
    await resize(data.url, data.width);
  },
});
```

---

## 2. Create a queue client

```ts
import { createQueueClient } from "@alegrossi2001/bullshoot";
import { sendEmail, resizeImage } from "./jobs";

export const queue = createQueueClient({
  redis: {
    host: "127.0.0.1",
    port: 6379,
  },

  jobs: [
    sendEmail,
    resizeImage,
  ],

  defaults: {
    removeOnComplete: {
      count: 1000,
    },
  },
});
```

The client owns everything required to run your queues:

* BullMQ queues
* Workers
* Queue events
* Scheduling helpers
* Type-safe producer API

---

## 3. Produce jobs

```ts
await queue.enqueue("email.send", {
  to: "user@example.com",
  subject: "Welcome!",
  body: "Thanks for joining.",
});
```

TypeScript catches mistakes before you deploy.

```ts
// Unknown job
queue.enqueue("email.snd", ...);

// Invalid payload
queue.enqueue("email.send", {
  to: 123,
});
```

---

## 4. Run workers

```ts
import { queue } from "./queue";

queue.startWorkers();
```

Or start only selected jobs.

```ts
queue.startWorkers({
  only: [
    "image.resize",
  ],
});
```

The producer and worker use the exact same client.

Only the processes that call `startWorkers()` execute handlers.

---

# Redis configuration

Explicit configuration is preferred.

```ts
createQueueClient({
  redis: {
    host,
    port,
    username,
    password,
    tls,
  },

  jobs,
});
```

Connection URLs are also supported.

```ts
createQueueClient({
  redis: {
    url: "rediss://:password@host:6379",
  },

  jobs,
});
```

TLS is automatically enabled for `rediss://`.

---

## Environment variables

If you prefer environment variables, opt in explicitly.

```ts
import { connectionFromEnv } from "@alegrossi2001/bullshoot";

createQueueClient({
  redis: connectionFromEnv(),
  jobs,
});
```

Supported variables:

* `REDIS_URL`
* `REDIS_HOST`
* `REDIS_PORT`
* `REDIS_USERNAME`
* `REDIS_PASSWORD`

Missing required values throw an exception.

The library never exits your process.

---

# Scheduling

Delayed jobs

```ts
await queue.scheduleOnce(
  "email.send",
  data,
  {
    delay: 60_000,
    jobId: "welcome:42",
  }
);
```

Repeatable jobs

```ts
await queue.schedule(
  "image.resize",
  data,
  {
    repeat: {
      cron: "0 3 * * *",
    },
  }
);

await queue.schedule(
  "image.resize",
  data,
  {
    repeat: {
      every: 30_000,
    },
  }
);
```

Remove a schedule

```ts
await queue.unschedule(
  "image.resize",
  {
    cron: "0 3 * * *",
  }
);
```

Bulk enqueue

```ts
await queue.bulkEnqueue(
  "email.send",
  [
    email1,
    email2,
    email3,
  ]
);
```

---

# Configuration precedence

Settings merge in this order.

```
Client defaults

↓

Job options

↓

enqueue() options
```

Later values always override earlier ones.

| Option           | Available on           | Default          |
| ---------------- | ---------------------- | ---------------- |
| attempts         | Client / Job / Enqueue | 3                |
| backoff          | Client / Job / Enqueue | Exponential (5s) |
| concurrency      | Client / Job           | 1                |
| lockDuration     | Client / Job           | 60000            |
| removeOnComplete | Client / Job / Enqueue | Disabled         |
| removeOnFail     | Client / Job / Enqueue | Disabled         |
| priority         | Enqueue                | —                |
| delay            | Enqueue                | —                |
| jobId            | Enqueue                | —                |

---

# Validation

Every worker validates incoming payloads before your handler executes.

```ts
schema.parse(payload);
```

If validation fails:

* the handler is never called
* the job fails normally
* retries behave exactly as BullMQ expects
* failures appear in Bull Board

Any validation library exposing

```ts
parse(unknown): T
```

is supported.

Zod works out of the box.

---

# Logging

Use any logger exposing

* debug
* info
* warn
* error

```ts
createQueueClient({
  redis,
  jobs,
  logger: pino(),
});
```

Disable logging entirely.

```ts
createQueueClient({
  redis,
  jobs,
  logger: false,
});
```

---

# Dashboard

```bash
npm install @bull-board/api @bull-board/express express
```

```ts
import express from "express";

import {
  mountDashboard,
} from "@alegrossi2001/bullshoot/dashboard";

import { queue } from "./queue";

const app = express();

const {
  router,
  basePath,
} = await mountDashboard(queue);

app.use(basePath, router);

app.listen(3000);
```

By default the dashboard is mounted at:

```
/admin/queues
```

---

# Escape hatches

Bullshoot intentionally does **not** hide BullMQ.

Need something unsupported?

Use the underlying objects directly.

```ts
queue.getQueue("email.send");
```

Inside handlers:

```ts
ctx.raw
```

Shutdown gracefully:

```ts
await queue.close();
```

---

# Why not just BullMQ?

BullMQ is already an excellent library.

Bullshoot is **not** a replacement.

Instead, it removes the repetitive infrastructure that many applications rebuild:

| BullMQ                                 | Bullshoot                   |
| -------------------------------------- | --------------------------- |
| Register queues manually               | Jobs register automatically |
| Validate payloads manually             | Validation built in         |
| Queue names are plain strings          | Fully typed queue names     |
| Producers and workers wired separately | One shared client           |
| Dashboard setup is manual              | Optional helper             |
| Direct BullMQ APIs                     | Still available             |

Whenever you need raw BullMQ functionality, you can access it directly.

---

# About

Bullshoot began as the queue infrastructure powering **QlickUp**, a commercial CRM platform handling production workloads including email delivery, automations, imports and background processing.

After proving the architecture in production, the infrastructure was extracted into a standalone open-source package focused on three goals:

* excellent TypeScript support
* minimal setup
* staying out of the way when advanced BullMQ features are needed

Rather than replacing BullMQ, bullshoot aims to make the common path dramatically simpler while keeping the full power of BullMQ available.

---

# License

MIT
