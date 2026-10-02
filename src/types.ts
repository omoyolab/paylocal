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

/** The fields `--amount`, `--email`, `--reference` and `--currency` can set. */
export type ShortcutName = "amount" | "email" | "reference" | "currency";

/**
 * Where a shortcut lands in a payload. One path, several paths that always hold the
 * same value, or `null` when the event has no such field.
 */
export type ShortcutTarget = string | string[] | null;

export interface EventDefinition {
  /** Event name exactly as the provider sends it, e.g. `charge.success`. */
  name: string;
  /** One-line description shown by `paylocal events`. */
  description: string;
  template: EventTemplate;
  /**
   * Where the shortcuts land for this event, when it differs from the provider's
   * defaults. A refund keeps its transaction reference in a different field from a
   * charge, for example.
   */
  shortcuts?: Partial<Record<ShortcutName, ShortcutTarget>>;
}

/** One notice in a scenario, and how it takes its values from the notices before it. */
export interface ScenarioStep {
  event: string;
  /** Fixed field overrides for this notice, such as a failed status. */
  set?: Record<string, unknown>;
  /**
   * Field overrides for this notice, worked out from the payloads already built.
   * `first` is the first notice in the scenario, `previous` is every earlier one.
   */
  link?: (
    first: Record<string, unknown>,
    previous: Record<string, unknown>[],
  ) => Record<string, unknown>;
}

/** A named run of related notices about one transaction. */
export interface ScenarioDefinition {
  name: string;
  /** One-line description shown by `paylocal scenarios`. */
  description: string;
  steps: ScenarioStep[];
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
  /** Maps CLI shortcuts (`--amount`) to payload paths (`data.amount`). An event can override these. */
  shortcuts: Record<ShortcutName, ShortcutTarget>;
  /** What unit `--amount` is in for this provider, for help text and output. */
  amountUnit: string;
  /** True when the signature covers the body, so a changed body must be refused. */
  signsBody: boolean;
  events: Record<string, EventDefinition>;
  scenarios: Record<string, ScenarioDefinition>;
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

/** What the endpoint did with a request it should have refused. */
export type ProbeOutcome = "rejected" | "accepted" | "crashed";

export interface VerifyProbe {
  /** `no-signature`, `wrong-secret` or `changed-body`. */
  name: string;
  /** What was wrong with the request, in words. */
  description: string;
  result: SendResult;
  /** `rejected` is a 3xx or 4xx, `accepted` a 2xx, `crashed` a 5xx. */
  outcome: ProbeOutcome;
}

export interface VerifyResult {
  provider: ProviderId;
  event: string;
  url: string;
  valid: SendResult;
  /** Every request the endpoint should have refused, in the order they were sent. */
  probes: VerifyProbe[];
  /** The last probe's response. Kept for code written against 0.1. */
  tampered: SendResult;
  /** The last probe's description. Kept for code written against 0.1. */
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
