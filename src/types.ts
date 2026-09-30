export type ProviderId = "paystack" | "flutterwave";

/** Helpers handed to event templates so every trigger produces fresh, realistic values. */
export interface EventContext {
  /** Timestamp used for every date field in the payload. */
  now: Date;
  /** Random positive integer id. */
  id: () => number;
  /** Random reference such as `ref_3f9a1c...`. */
  ref: (prefix?: string) => string;
  /** Random provider-style code such as `CUS_x1y2z3`. */
  code: (prefix: string) => string;
}

export type EventTemplate = (ctx: EventContext) => Record<string, unknown>;

export interface EventDefinition {
  /** Event name exactly as the provider sends it, e.g. `charge.success`. */
  name: string;
  /** One-line description shown by `paylocal events`. */
  description: string;
  template: EventTemplate;
}

export interface Provider {
  id: ProviderId;
  /** Human-readable name. */
  name: string;
  /** Environment variable that holds the signing secret. */
  secretEnv: string;
  /** What the provider calls the secret in its dashboard. */
  secretLabel: string;
  /** HTTP header that carries the signature. */
  signatureHeader: string;
  /** Link to the provider's webhook documentation. */
  docs: string;
  /** Event used by `paylocal verify` when none is given. */
  verifyEvent: string;
  /** Maps CLI shortcuts (`--amount`) to payload paths (`data.amount`). */
  shortcuts: Record<string, string>;
  events: Record<string, EventDefinition>;
  /** Produces the headers a real delivery from this provider would carry. */
  sign: (body: string, secret: string) => Record<string, string>;
  /** Produces a request that must fail signature verification. */
  tamper: (body: string, headers: Record<string, string>) => TamperedRequest;
  /** Fields worth showing in CLI output. */
  summarize: (payload: Record<string, unknown>) => Array<[string, string]>;
}

export interface TamperedRequest {
  body: string;
  headers: Record<string, string>;
  /** How the request was tampered, for the verify report. */
  description: string;
}

export interface BuiltEvent {
  provider: ProviderId;
  event: string;
  payload: Record<string, unknown>;
  /** Exact JSON string that will be sent and signed. */
  body: string;
}

export interface SignedEvent extends BuiltEvent {
  headers: Record<string, string>;
}

export interface SendOptions {
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number;
  /** Extra headers merged into the request. */
  headers?: Record<string, string>;
}

export interface SendResult {
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
  responseBody: string;
}

export type Verdict = "verified" | "not-verified" | "inconclusive";

export interface VerifyResult {
  provider: ProviderId;
  event: string;
  url: string;
  valid: SendResult;
  tampered: SendResult;
  tamperDescription: string;
  verdict: Verdict;
  notes: string[];
}

export interface LogEntry {
  id: string;
  at: string;
  provider: ProviderId;
  event: string;
  url: string;
  status: number;
  ok: boolean;
  durationMs: number;
  payload: Record<string, unknown>;
}
