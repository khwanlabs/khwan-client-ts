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
  // ── 1) The memory loop: prepare → (your own model) → record ──────────────
  // No `core` → the account's DEFAULT core (its original brain). Khwan builds
  // the context (memory + constitution + coherence gate) but NEVER calls a
  // model — you always run your own.
  const kw = new Khwan({ apiKey: apiKey!, userId: "dev-alice", baseUrl });

  const first = await kw.prepare("สวัสดี ช่วยจำไว้ว่าโปรเจกต์ผมชื่อ Aurora");
  const firstAnswer = await callYourModel(first.messages);
  await kw.record(first, firstAnswer); // persist + learn from your model's answer
  console.log("assistant:", firstAnswer);
  console.log("coherence:", first.coherence, "· sources:", first.sources.length);

  // ── 2) Cores: isolated brains within the same account ────────────────────
  // List what's available (the default core is always included).
  console.log("\ncores:", await kw.cores());

  // Target a specific core just by passing `core`. Each named core is a fully
  // isolated brain — its own memory/identity. Same api key + account.
  const test = new Khwan({ apiKey: apiKey!, userId: "dev-alice", baseUrl, core: "test" });
  const client1 = new Khwan({ apiKey: apiKey!, userId: "dev-alice", baseUrl, core: "client1" });

  // Teach two cores two different "facts" — same loop, different core…
  await recordTurn(test, "จำไว้ว่า environment นี้คือ TEST, ห้ามยิง production");
  await recordTurn(client1, "ลูกค้าเจ้านี้ชื่อ Contoso, โทนคุยแบบทางการ");

  // …then ask each the same question — the answers should NOT leak across cores,
  // because test and client1 have separate memory.
  console.log("\n[test]   ", await recordTurn(test, "environment อะไร?"));
  console.log("[client1]", await recordTurn(client1, "ลูกค้าชื่ออะไร?"));

  // ── 3) A turn that may be blocked by the constitution ────────────────────
  const turn = await test.prepare("สรุป rule ของ environment นี้ให้หน่อย");
  if (!turn.allowed) {
    console.log("\n[blocked] by constitution:", turn.reason);
  } else {
    // `turn.messages` is ready to feed straight into your LLM of choice.
    const answer = await callYourModel(turn.messages);
    await test.record(turn, answer);
    console.log("\n[ok] recorded. context messages:", turn.messages.length);
  }

  // ── 4) Inspection ────────────────────────────────────────────────────────
  console.log("\nrecent memory (test core):", await test.memory(5));
  console.log("metrics (default core):", await kw.metrics());
}

/** Run one full memory loop (prepare → your model → record) and return the answer. */
async function recordTurn(kw: Khwan, input: string): Promise<string> {
  const turn = await kw.prepare(input);
  const answer = await callYourModel(turn.messages);
  await kw.record(turn, answer);
  return answer;
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
