/**
 * Khwan hosted client (public).
 *
 * A thin HTTP wrapper — contains NO Khwan engine code. The Brain (memory,
 * constitution, coherence, learning) runs on the Khwan server; this client
 * just connects and hands results back to your app.
 *
 * Positioning: Khwan is a pure **AI-memory layer** — it never runs a model.
 * You always call your own model (BYOM). The only loop is
 * `prepare` → (your model) → `record`:
 *
 * ```ts
 * const kw = new Khwan({ apiKey: "kwk_live_xxx", userId: "alice" });
 * const turn = await kw.prepare("remember I like short answers"); // no LLM on Khwan's side
 * const answer = await yourModel(turn.messages);                  // your model, your key
 * await kw.record(turn, answer);                                  // Khwan learns
 * ```
 *
 * `memory`/`embedder` are NOT configurable here — they are server-managed. They
 * exist only in the on-prem engine (shipped under license).
 *
 * @packageDocumentation
 */

/** Client library version. */
export const VERSION = "0.1.0";

/** Default Khwan API base URL. */
export const DEFAULT_BASE_URL = "https://api.khwan.ai";

/** Shape of a single chat message forwarded to your own model. */
export interface Message {
  role: string;
  content: string;
  [key: string]: unknown;
}

/** Raw JSON returned by `POST /prepare`. */
export interface TurnData {
  messages?: Message[];
  coherence?: number | null;
  sources?: unknown[];
  allowed?: boolean;
  reason?: string | null;
  turn_token?: string | null;
  [key: string]: unknown;
}

/** Options for constructing a {@link Khwan} client. */
export interface KhwanOptions {
  /** API key from your Khwan dashboard. Required. */
  apiKey: string;
  /**
   * OPTIONAL end-user id. Omit for one shared brain per account/core. Set it (sent as
   * `X-Khwan-User`) to give each of your end-users a fully ISOLATED sub-brain — one
   * API key → a private brain per user. Requires a paid plan. Isolation combines with
   * `core`: `account::<core>::@<user>`.
   */
  userId?: string;
  /** Override the API base URL. Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Model hint forwarded to the server on `prepare`. */
  model?: string;
  /**
   * Selects the isolated core this client targets. Each named core is a fully
   * isolated brain (its own memory, identity, learning) within the same
   * account. Omit ⇒ the account's default core.
   */
  core?: string;
  /** Named constitution profile reference forwarded to the server. */
  constitution?: string;
  /** Per-request timeout in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
  /**
   * Server-managed — NOT configurable in the hosted client. Passing this throws.
   * @internal
   */
  memory?: unknown;
  /**
   * Server-managed — NOT configurable in the hosted client. Passing this throws.
   * @internal
   */
  embedder?: unknown;
}

/** Raised on a non-2xx response. `status` is the HTTP status code. */
export class KhwanError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "KhwanError";
    this.status = status;
    // Restore prototype chain for instanceof across compile targets.
    Object.setPrototypeOf(this, KhwanError.prototype);
  }
}

/**
 * Context Khwan prepared for one turn. Feed `.messages` to your own model,
 * then pass this object (plus the model's answer) back to {@link Khwan.record}.
 */
export class Turn {
  private readonly _d: TurnData;

  constructor(data: TurnData) {
    this._d = data;
  }

  /** Messages to feed to your own model. */
  get messages(): Message[] {
    return this._d.messages ?? [];
  }

  /** Coherence score for the prepared context, if any. */
  get coherence(): number | null {
    return this._d.coherence ?? null;
  }

  /** Memory/context sources the server drew on. */
  get sources(): unknown[] {
    return this._d.sources ?? [];
  }

  /** Whether the constitution allows this turn to proceed. */
  get allowed(): boolean {
    return this._d.allowed ?? true;
  }

  /** Human-readable reason, e.g. when `allowed` is false. */
  get reason(): string | null {
    return this._d.reason ?? null;
  }

  /** Opaque token that ties this prepared turn to a later `record` call. */
  get turnToken(): string | null {
    return this._d.turn_token ?? null;
  }

  /** The raw prepared payload. */
  raw(): TurnData {
    return this._d;
  }
}

type HttpMethod = "GET" | "POST";

/**
 * Thin HTTP client for the Khwan hosted memory layer.
 *
 * Khwan never generates text — you always call your own model. The only loop
 * is `prepare` → (your model) → `record`.
 *
 * @example
 * ```ts
 * const kw = new Khwan({ apiKey: "kwk_live_xxx", userId: "alice" });
 * const turn = await kw.prepare("hello");
 * const answer = await yourModel(turn.messages);
 * await kw.record(turn, answer);
 * ```
 */
export class Khwan {
  /** The end-user this client acts for, if any — set ⇒ an isolated per-user sub-brain. */
  readonly userId?: string;

  /** The isolated core this client targets, if any (omit ⇒ default core). */
  readonly core?: string;

  private readonly _key: string;
  private readonly _base: string;
  private readonly _timeoutMs: number;
  private readonly _cfg: Record<string, string>;

  constructor(options: KhwanOptions) {
    const {
      apiKey,
      userId,
      baseUrl = DEFAULT_BASE_URL,
      model,
      constitution,
      core,
      timeoutMs = 60_000,
      memory,
      embedder,
    } = options;

    if (memory !== undefined || embedder !== undefined) {
      throw new TypeError(
        "memory/embedder are server-managed in the hosted client; they are " +
          "only configurable in the on-prem engine (khwan-engine, under license).",
      );
    }
    if (!apiKey) {
      throw new Error(
        "apiKey is required (get one from your Khwan dashboard).",
      );
    }

    this.userId = userId;
    this.core = core;
    this._key = apiKey;
    this._base = baseUrl.replace(/\/+$/, "");
    this._timeoutMs = timeoutMs;

    // Session config forwarded to the server (model may be overridden by the
    // account's dashboard settings; constitution is a named profile reference).
    const cfg: Record<string, string> = {};
    if (model) cfg.model = model;
    if (constitution) cfg.constitution = constitution;
    this._cfg = cfg;
  }

  // ---- transport ----

  private _headers(): Record<string, string> {
    const h: Record<string, string> = { "X-API-Key": this._key };
    if (this.userId) h["X-Khwan-User"] = this.userId; // optional: isolated sub-brain per end-user
    if (this.core) h["X-Khwan-Core"] = this.core; // select the isolated core
    return h;
  }

  private async _request<T = Record<string, unknown>>(
    method: HttpMethod,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const headers = this._headers();
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._timeoutMs);

    let res: Response;
    try {
      res = await fetch(this._base + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new KhwanError(0, `request timed out after ${this._timeoutMs}ms`);
      }
      throw new KhwanError(
        0,
        `network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (Math.floor(res.status / 100) !== 2) {
      const friendly: Record<number, string> = {
        401: "unauthorized — bad or missing API key",
        402: "payment required — add a payment method / upgrade your plan",
        429: "quota exceeded — you are over your plan's limit",
      };
      let message = friendly[res.status];
      if (!message) {
        const detail = await res.text().catch(() => "");
        message = detail ? detail.slice(0, 300) : `HTTP ${res.status}`;
      }
      throw new KhwanError(res.status, message);
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  // ---- the memory loop: prepare → (your model) → record ----

  /**
   * Khwan builds the context (memory + constitution + coherence). No LLM call.
   * Feed the returned {@link Turn.messages} to your own model.
   */
  async prepare(input: string): Promise<Turn> {
    const data = await this._request<TurnData>("POST", "/prepare", {
      input,
      ...this._cfg,
    });
    return new Turn(data);
  }

  /**
   * Hand your model's answer back so Khwan can persist + learn.
   * @param turn The turn returned by {@link Khwan.prepare}.
   * @param answer Your model's response text.
   */
  async record(turn: Turn, answer: string): Promise<void> {
    await this._request("POST", "/record", {
      turn_token: turn.turnToken,
      answer,
    });
  }

  // ---- learning / inspection ----

  /** Trigger a server-side learning/consolidation sync. */
  async sync(): Promise<Record<string, unknown>> {
    return this._request("POST", "/sync");
  }

  /** Fetch recent memory entries for this user. */
  async memory(limit = 20): Promise<Record<string, unknown>> {
    return this._request("GET", `/memory?limit=${encodeURIComponent(limit)}`);
  }

  /** Fetch usage/coherence metrics for this user. */
  async metrics(): Promise<Record<string, unknown>> {
    return this._request("GET", "/metrics");
  }

  /**
   * List the isolated cores available on this account. The account's default
   * core is included with `is_default: true`.
   */
  async cores(): Promise<Array<{ slug: string; name: string; is_default: boolean }>> {
    return this._request("GET", "/cores");
  }
}

export default Khwan;
