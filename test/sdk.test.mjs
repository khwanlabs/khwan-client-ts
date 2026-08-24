/**
 * verify / lessons / synthesize — the endpoints the SDK was missing.
 *
 * The one that matters beyond wiring: `synthesize` must never call a model
 * itself. The whole claim of the BYOM path is that the distillation is yours, so
 * a future refactor that "helpfully" adds a default model would break the
 * product's promise, not just a test.
 *
 * Run: npm test   (node --test, no dependencies)
 */
import assert from "node:assert/strict";
import test from "node:test";

import { Khwan, Turn } from "../dist/index.js";

function client() {
  return new Khwan({ apiKey: "kwk_test", baseUrl: "https://example.invalid" });
}

function turn(token = "tt_1") {
  return new Turn({ messages: [], turn_token: token, allowed: true });
}

/** Swap the private _request for a recorder. Returns the calls array. */
function recordCalls(kw, reply) {
  const calls = [];
  kw._request = async (method, path, body) => {
    calls.push({ method, path, body });
    return typeof reply === "function" ? reply(method, path, body) : (reply ?? {});
  };
  return calls;
}

test("verify posts the draft with its turn token", async () => {
  const kw = client();
  const calls = recordCalls(kw, { ok: false, reason: "contradicts a stored preference" });

  const out = await kw.verify(turn("tt_9"), "Absolutely, you're completely right.");

  assert.deepEqual(calls, [{
    method: "POST",
    path: "/verify",
    body: { answer: "Absolutely, you're completely right.", turn_token: "tt_9" },
  }]);
  assert.equal(out.ok, false);
});

test("verify omits turn_token when the turn has none", async () => {
  const kw = client();
  const calls = recordCalls(kw, { ok: true });
  await kw.verify(turn(null), "a draft");
  assert.deepEqual(calls[0].body, { answer: "a draft" });
});

test("verify retries; synthesize prepare/record do not", () => {
  const kw = client();
  // /verify never consumes the token server-side, so a retry is safe.
  // /synthesize/prepare mints a new batch each call — retrying orphans one.
  assert.equal(kw._isIdempotent("POST", "/verify"), true);
  assert.equal(kw._isIdempotent("POST", "/synthesize/prepare"), false);
  assert.equal(kw._isIdempotent("POST", "/synthesize/record"), false);
});

test("lessons() returns the list, not the envelope", async () => {
  const kw = client();
  recordCalls(kw, { lessons: [{ id: "L1", response_text: "Answer in Thai." }] });
  const out = await kw.lessons();
  assert.ok(Array.isArray(out));
  assert.equal(out[0].id, "L1");
});

test("deleteLesson → DELETE, editLesson → PATCH with the new text", async () => {
  const kw = client();
  const calls = recordCalls(kw, { status: "ok" });
  await kw.deleteLesson("L1");
  await kw.editLesson("L2", "Answer in Thai, briefly.");
  assert.deepEqual(calls[0], { method: "DELETE", path: "/lessons/L1", body: undefined });
  assert.deepEqual(calls[1], {
    method: "PATCH", path: "/lessons/L2", body: { text: "Answer in Thai, briefly." },
  });
});

test("synthesize calls YOUR distill per cluster and posts the results — nothing else", async () => {
  const kw = client();
  const posted = [];
  kw._request = async (method, path, body) => {
    if (path === "/synthesize/prepare") {
      return {
        synthesis_token: "st_1", system: "SYS", packets_scanned: 9,
        clusters: [{ id: "c0", prompt: "P0" }, { id: "c1", prompt: "P1" }],
      };
    }
    posted.push({ method, path, body });
    return { lessons_created: 1, skipped: 1, status: "ok" };
  };

  const distilled = [];
  const out = await kw.synthesize((system, prompt) => {
    distilled.push([system, prompt]);
    return prompt === "P0" ? "Answer in Thai." : "NONE";
  });

  assert.deepEqual(distilled, [["SYS", "P0"], ["SYS", "P1"]]);
  assert.deepEqual(posted, [{
    method: "POST", path: "/synthesize/record",
    body: {
      synthesis_token: "st_1",
      lessons: [
        { cluster_id: "c0", text: "Answer in Thai." },
        { cluster_id: "c1", text: "NONE" },
      ],
    },
  }]);
  assert.equal(out.lessons_created, 1);
});

test("no token → no record call, and distill is never invoked", async () => {
  const kw = client();
  const posted = [];
  kw._request = async (method, path) => {
    if (path === "/synthesize/prepare") {
      return { synthesis_token: null, clusters: [], packets_scanned: 0 };
    }
    posted.push(path);
    return {};
  };

  const out = await kw.synthesize(() => {
    throw new Error("distill must not be called when there is nothing to learn");
  });

  assert.deepEqual(posted, []);
  assert.equal(out.status, "skipped");
});

test("a cluster whose distill throws is skipped; the rest still record", async () => {
  const kw = client();
  let sent = null;
  kw._request = async (method, path, body) => {
    if (path === "/synthesize/prepare") {
      return {
        synthesis_token: "st_1", system: "SYS",
        clusters: [{ id: "c0", prompt: "P0" }, { id: "c1", prompt: "P1" }],
      };
    }
    sent = body;
    return { lessons_created: 1 };
  };

  await kw.synthesize((_system, prompt) => {
    if (prompt === "P0") throw new Error("model timed out");
    return "Answer in Thai.";
  });

  assert.deepEqual(sent.lessons, [
    { cluster_id: "c0", text: null },
    { cluster_id: "c1", text: "Answer in Thai." },
  ]);
});

test("an async distill is awaited", async () => {
  const kw = client();
  let sent = null;
  kw._request = async (method, path, body) => {
    if (path === "/synthesize/prepare") {
      return { synthesis_token: "st_1", system: "SYS", clusters: [{ id: "c0", prompt: "P0" }] };
    }
    sent = body;
    return {};
  };

  await kw.synthesize(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return "Answer in Thai.";
  });

  // Without an await inside synthesize this would be a Promise, not the string.
  assert.deepEqual(sent.lessons, [{ cluster_id: "c0", text: "Answer in Thai." }]);
});
