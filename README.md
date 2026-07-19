# @khwan/client

Thin TypeScript/JavaScript client for [Khwan](https://khwan.ai) — a hosted
**cognition layer** (memory + identity + learning) for AI agents.

This package is a **thin HTTP wrapper**. It contains no engine logic: the Brain
(memory, constitution, coherence, learning) runs on the Khwan server. The
client just prepares context, hands it to you, and records the result.

Khwan is **BYOM (bring your own model)**. You keep calling your own LLM with
your own key — Khwan never sees or gates your model. It prepares the context
before your call and learns from the answer after.

> `memory` and `embedder` are **server-managed** and are not configurable from
> this client. They exist only in the on-prem engine (shipped under license).

## Install

```bash
npm i @khwan/client
```

Requires Node.js 18+ (uses the global `fetch`). No runtime dependencies.

## BYOM usage (recommended)

`prepare` → **call your own model** → `record`.

```ts
import { Khwan } from "@khwan/client";

const fc = new Khwan({
  apiKey: process.env.KHWAN_API_KEY!,
  userId: "alice",
});

// 1. Khwan builds the context (memory + constitution + coherence). No LLM call.
const turn = await fc.prepare("remember I like short answers");

if (!turn.allowed) {
  throw new Error(`blocked by constitution: ${turn.reason}`);
}

// 2. Call YOUR OWN model with the prepared messages — your provider, your key.
const answer = await myOwnLLM(turn.messages);

// 3. Hand the answer back so Khwan can persist + learn.
await fc.record(turn, answer);
```

## chat() convenience

If your plan enables server-side generation, `chat()` prepares context and
generates the reply in one call:

```ts
import { Khwan } from "@khwan/client";

const fc = new Khwan({
  apiKey: process.env.KHWAN_API_KEY!,
  userId: "alice",
});

const reply = await fc.chat("remember I like short answers");
console.log(reply.text);
console.log(reply.coherence, reply.sources);
```

## Selecting a core (แกน)

An account can hold multiple **isolated cores** (แกน) — each a fully separate
brain (its own memory, identity, learning) that shares the account's quota.
Pass `core` to target a named core; omit it to use the account's **default**
core.

```ts
const kw = new Khwan({ apiKey: "kwk_...", userId: "alice", core: "client1" });

// List the cores available on this account (default core included).
const cores = await kw.cores();
// → [{ slug: "default", name: "Default", is_default: true }, { slug: "client1", ... }]
```

Every request from this client carries an `X-Khwan-Core` header, so all of
`prepare` / `record` / `chat` / `memory` / `sync` / `metrics` operate against
the selected core. Omitting `core` uses the default core (backward compatible).

## Other methods

```ts
await fc.sync();          // trigger server-side learning/consolidation
await fc.memory(20);      // recent memory entries (default limit 20)
await fc.metrics();       // usage / coherence metrics
await fc.cores();         // list isolated cores (แกน) on the account
```

## Errors

Non-2xx responses throw a `KhwanError` with a `.status` field and a friendly
message for `401` / `402` / `429`:

```ts
import { Khwan, KhwanError } from "@khwan/client";

try {
  await fc.prepare("hi");
} catch (err) {
  if (err instanceof KhwanError) {
    console.error(err.status, err.message);
  }
}
```

## Configuration

```ts
new Khwan({
  apiKey: "kwk_live_xxx",   // required — from your Khwan dashboard
  userId: "alice",          // one key can drive many end-user brains
  baseUrl: "https://api.khwan.ai", // optional override
  model: "gpt-4o",          // optional hint forwarded on prepare/chat
  constitution: "support",  // optional named constitution profile
  core: "client1",          // optional isolated core (แกน); omit ⇒ default core
  timeoutMs: 60000,         // optional per-request timeout
});
```

## License

Proprietary. See `LICENSE`.
