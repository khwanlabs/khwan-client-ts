# @khwan/client

Thin TypeScript/JavaScript client for [Khwan](https://khwan.ai) — a hosted
**cognition layer** (memory + identity + learning) for AI agents.

This package is a **thin HTTP wrapper**. It contains no engine logic: the Brain
(memory, constitution, coherence, learning) runs on the Khwan server. The
client just prepares context, hands it to you, and records the result.

**Khwan never generates text.** It is a pure AI-memory layer — you always call
your own model (BYOM). The only loop is `prepare` → your model → `record`:
Khwan prepares the context before your call and learns from the answer after,
but it never runs a model itself.

> `memory` and `embedder` are **server-managed** and are not configurable from
> this client. They exist only in the on-prem engine (shipped under license).

## Install

```bash
npm i @khwan/client
```

Requires Node.js 18+ (uses the global `fetch`). No runtime dependencies.

## Usage — the memory loop

`prepare` → **call your own model** → `record`. This is the only loop; Khwan
never generates the reply for you.

```ts
import { Khwan } from "@khwan/client";

const kw = new Khwan({
  apiKey: process.env.KHWAN_API_KEY!,
  userId: "alice",
});

// 1. Khwan builds the context (memory + constitution + coherence). No LLM call.
const turn = await kw.prepare("remember I like short answers");

if (!turn.allowed) {
  throw new Error(`blocked by constitution: ${turn.reason}`);
}

// 2. Call YOUR OWN model with the prepared messages — your provider, your key.
const answer = await yourModel(turn.messages);

// 3. Hand the answer back so Khwan can persist + learn.
await kw.record(turn, answer);

// `record` is awaited by default, on purpose: `prepare` for the next turn reads
// what has been written, so a record still in flight drops this turn from the
// next turn's context — only under load, which makes it read as flaky memory
// rather than as a race. Skip the wait when the turn is the last one:
await kw.record(turn, answer, { background: true });
```

## Selecting a core

An account can hold multiple **isolated cores** — each a fully separate brain
(its own memory, identity, learning) that shares the account's quota. Pass
`core` to target a named core; omit it to use the account's **default** core.

```ts
const kw = new Khwan({ apiKey: "kwk_...", userId: "alice", core: "client1" });

// List the cores available on this account (default core included).
const cores = await kw.cores();
// → [{ slug: "default", name: "Default", is_default: true }, { slug: "client1", ... }]
```

Every request from this client carries an `X-Khwan-Core` header, so all of
`prepare` / `record` / `memory` / `sync` / `metrics` operate against the
selected core. Omitting `core` uses the default core (backward compatible).

## Other methods

```ts
await kw.sync();          // trigger server-side learning/consolidation
await kw.memory(20);      // recent memory entries (default limit 20)
await kw.metrics();       // usage / coherence metrics
await kw.cores();         // list isolated cores on the account
```

## Errors

Non-2xx responses throw a `KhwanError` with a `.status` field and a friendly
message for `401` / `402` / `429`:

```ts
import { Khwan, KhwanError } from "@khwan/client";

try {
  await kw.prepare("hi");
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
  model: "gpt-4o",          // optional hint forwarded on prepare
  constitution: "support",  // optional named constitution profile
  core: "client1",          // optional isolated core; omit ⇒ default core
  timeoutMs: 60000,         // optional per-request timeout
});
```

## License

Proprietary. See `LICENSE`.
