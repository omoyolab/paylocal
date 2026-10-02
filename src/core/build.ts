import { PaylocalError } from "../errors.js";
import { getEvent, getProvider } from "../providers/index.js";
import type {
  BuiltEvent,
  EventDefinition,
  Provider,
  SendOptions,
  SendResult,
  ShortcutName,
  ShortcutTarget,
  SignedEvent,
} from "../types.js";
import { setPath } from "../util/path.js";
import { createContext } from "../util/random.js";
import { deliver } from "./send.js";

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

  const shortcuts: Array<[ShortcutName, unknown]> = [
    ["amount", options.amount],
    ["email", options.email],
    ["reference", options.reference],
    ["currency", options.currency],
  ];
  for (const [name, value] of shortcuts) {
    if (value === undefined) continue;
    const target = shortcutTarget(provider, definition, name);
    if (target === null) {
      throw new PaylocalError(
        `${provider.name} ${definition.name} has no ${name} field`,
        `Leave out the ${name} shortcut, or set a field of your own with --set path=value`,
      );
    }
    for (const path of Array.isArray(target) ? target : [target]) setPath(payload, path, value);
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

/** Where a shortcut lands for one event: the event's own answer if it has one, else the provider's. */
export function shortcutTarget(
  provider: Provider,
  definition: EventDefinition,
  name: ShortcutName,
): ShortcutTarget {
  const own = definition.shortcuts?.[name];
  return own !== undefined ? own : provider.shortcuts[name];
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

export interface FixtureRequest {
  body: string;
  headers: Record<string, string>;
}

export interface WebhookFixture {
  provider: string;
  event: string;
  payload: Record<string, unknown>;
  body: string;
  /** Returns the body and headers ready to hand to supertest, fetch or any HTTP client. */
  sign: (secret: string) => FixtureRequest;
  /**
   * A request your endpoint must refuse: signed correctly, then altered. For a provider
   * that signs the body the body is changed; otherwise the signature header is.
   */
  tamper: (secret: string) => FixtureRequest & { description: string };
  /** The body with no signature header at all. Your endpoint must refuse this too. */
  unsigned: () => FixtureRequest;
  /** Signs the notice and POSTs it to `url`, the way the provider would. */
  send: (url: string, secret: string, options?: SendOptions) => Promise<SendResult>;
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
  return fixture(buildEvent(providerId, eventName, options));
}

const JSON_TYPE = { "content-type": "application/json" };

/** Wraps a built event in the helpers a test suite uses. */
export function fixture(built: BuiltEvent): WebhookFixture {
  const provider = getProvider(built.provider);
  return {
    provider: built.provider,
    event: built.event,
    payload: built.payload,
    body: built.body,
    sign(secret) {
      const signed = signEvent(built, secret);
      return { body: signed.body, headers: { ...JSON_TYPE, ...signed.headers } };
    },
    tamper(secret) {
      const signed = signEvent(built, secret);
      const tampered = provider.tamper(signed.body, signed.headers);
      return {
        body: tampered.body,
        headers: { ...JSON_TYPE, ...tampered.headers },
        description: tampered.description,
      };
    },
    unsigned() {
      return { body: built.body, headers: { ...JSON_TYPE } };
    },
    send(url, secret, sendOptions) {
      const signed = signEvent(built, secret);
      return deliver({ body: signed.body, headers: signed.headers }, url, sendOptions);
    },
  };
}
