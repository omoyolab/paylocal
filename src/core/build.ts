import { PaylocalError } from "../errors.js";
import { getEvent, getProvider } from "../providers/index.js";
import type { BuiltEvent, SignedEvent } from "../types.js";
import { setPath } from "../util/path.js";
import { createContext } from "../util/random.js";

export interface BuildOptions {
  /** Field overrides keyed by dotted path, e.g. `{ "data.amount": 250000 }`. */
  set?: Record<string, unknown>;
  /** Shortcut for the provider's amount field. */
  amount?: number;
  /** Shortcut for the provider's customer email field. */
  email?: string;
  /** Shortcut for the provider's transaction reference field. */
  reference?: string;
  /** Shortcut for the provider's currency field. */
  currency?: string;
  /** Fixed timestamp for deterministic payloads (tests). Defaults to now. */
  now?: Date;
}

/** Builds a fresh, realistic payload for the given provider event. */
export function buildEvent(
  providerId: string,
  eventName: string,
  options: BuildOptions = {},
): BuiltEvent {
  const provider = getProvider(providerId);
  const definition = getEvent(providerId, eventName);
  const payload = definition.template(createContext(options.now));

  const shortcuts: Array<[keyof BuildOptions, unknown]> = [
    ["amount", options.amount],
    ["email", options.email],
    ["reference", options.reference],
    ["currency", options.currency],
  ];
  for (const [name, value] of shortcuts) {
    if (value === undefined) continue;
    const path = provider.shortcuts[name];
    if (!path) {
      throw new PaylocalError(
        `${provider.name} has no "${name}" shortcut`,
        "Use --set path=value instead",
      );
    }
    setPath(payload, path, value);
  }

  for (const [path, value] of Object.entries(options.set ?? {})) {
    setPath(payload, path, value);
  }

  return {
    provider: provider.id,
    event: definition.name,
    payload,
    body: JSON.stringify(payload),
  };
}

/** Attaches the headers the provider would send for this exact body. */
export function signEvent(built: BuiltEvent, secret: string): SignedEvent {
  if (!secret) {
    throw new PaylocalError("A signing secret is required");
  }
  const provider = getProvider(built.provider);
  return { ...built, headers: provider.sign(built.body, secret) };
}

/** Rebuilds a signed event from a stored payload, e.g. for replay. */
export function fromPayload(providerId: string, payload: Record<string, unknown>): BuiltEvent {
  const provider = getProvider(providerId);
  const event = typeof payload.event === "string" ? payload.event : "unknown";
  return { provider: provider.id, event, payload, body: JSON.stringify(payload) };
}

export interface WebhookFixture {
  provider: string;
  event: string;
  payload: Record<string, unknown>;
  body: string;
  /** Returns the body and headers ready to hand to supertest, fetch or any HTTP client. */
  sign: (secret: string) => { body: string; headers: Record<string, string> };
}

/**
 * Fluent helper for test suites.
 *
 * @example
 * const { body, headers } = webhook("paystack", "charge.success", { amount: 5000 }).sign(secret);
 * await request(app).post("/webhooks/paystack").set(headers).send(body);
 */
export function webhook(
  providerId: string,
  eventName: string,
  options: BuildOptions = {},
): WebhookFixture {
  const built = buildEvent(providerId, eventName, options);
  return {
    provider: built.provider,
    event: built.event,
    payload: built.payload,
    body: built.body,
    sign(secret) {
      const signed = signEvent(built, secret);
      return {
        body: signed.body,
        headers: { "content-type": "application/json", ...signed.headers },
      };
    },
  };
}
