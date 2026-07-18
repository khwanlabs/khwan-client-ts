/**
 * Dev example — using @khwan/client end to end.
 *
 * Run against a LOCAL engine while developing:
 *   1. start the engine (khwan-engine) on http://127.0.0.1:8010
 *   2. export KHWAN_API_KEY=kwk_...        # a key from the dashboard / create_user.py
 *      export KHWAN_BASE_URL=http://127.0.0.1:8010   # optional; defaults below
 *   3. npx tsx examples/dev.ts
 *
 * Nothing here is hard-coded — the key comes from the environment.
 */

import { Khwan, KhwanError } from "../src/index.js";

const apiKey = process.env.KHWAN_API_KEY;
const baseUrl = process.env.KHWAN_BASE_URL ?? "http://127.0.0.1:8010";
if (!apiKey) {
  console.error("Set KHWAN_API_KEY first (a kwk_… key from your dashboard).");
  process.exit(1);
}

async function main() {
  // ── 1) Basic hosted chat ────────────────────────────────────────────────
  // No `core` → the account's DEFAULT core (its original brain).
  const kw = new Khwan({ apiKey: apiKey!, userId: "dev-alice", baseUrl });

  const reply = await kw.chat("สวัสดี ช่วยจำไว้ว่าโปรเจกต์ผมชื่อ Aurora");
  console.log("assistant:", reply.text);
  console.log("coherence:", reply.coherence, "· sources:", reply.sources.length);

  // ── 2) Cores (แกน): isolated brains within the same account ──────────────
  // List what's available (the default core is always included).
  console.log("\ncores:", await kw.cores());

  // Target a specific core just by passing `core`. Each named core is a fully
  // isolated brain — its own memory/identity. Same api key + account, different แกน.
  const test = new Khwan({ apiKey: apiKey!, userId: "dev-alice", baseUrl, core: "test" });
  const client1 = new Khwan({ apiKey: apiKey!, userId: "dev-alice", baseUrl, core: "client1" });

  // Teach two cores two different "facts"…
  await test.chat("จำไว้ว่า environment นี้คือ TEST, ห้ามยิง production");
  await client1.chat("ลูกค้าเจ้านี้ชื่อ Contoso, โทนคุยแบบทางการ");

  // …then ask each the same question — the answers should NOT leak across cores,
  // because test and client1 have separate memory.
  console.log("\n[test]   ", (await test.chat("environment อะไร?")).text);
  console.log("[client1]", (await client1.chat("ลูกค้าชื่ออะไร?")).text);

  // ── 3) BYOM: prepare → (your own model) → record ─────────────────────────
  // Khwan builds the context (memory + constitution + coherence gate) but does
  // NOT call any model. You run YOUR model, then hand the answer back to learn.
  const byom = new Khwan({ apiKey: apiKey!, userId: "dev-alice", baseUrl, core: "test" });

  const turn = await byom.prepare("สรุป rule ของ environment นี้ให้หน่อย");
  if (!turn.allowed) {
    console.log("\n[byom] blocked by constitution:", turn.reason);
  } else {
    // `turn.messages` is ready to feed straight into your LLM of choice.
    const answer = await callYourModel(turn.messages);
    await byom.record(turn, answer); // persist + learn from your model's answer
    console.log("\n[byom] recorded. context messages:", turn.messages.length);
  }

  // ── 4) Inspection ────────────────────────────────────────────────────────
  console.log("\nrecent memory (test core):", await test.memory(5));
  console.log("metrics (default core):", await kw.metrics());
}

/** Stand-in for whatever model you bring (OpenAI, Anthropic, a local model…). */
async function callYourModel(messages: { role: string; content: string }[]): Promise<string> {
  // e.g. const r = await openai.chat.completions.create({ model, messages });
  //      return r.choices[0].message.content;
  return `(demo) ได้รับ ${messages.length} ข้อความ context แล้ว`;
}

main().catch((err) => {
  if (err instanceof KhwanError) {
    console.error(`KhwanError ${err.status}: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
