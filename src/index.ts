/**
 * paylocal: local webhook tooling for Paystack and Flutterwave.
 *
 * @example
 * import { webhook } from "@omoyolab/paylocal";
 *
 * const { body, headers } = webhook("paystack", "charge.success", { amount: 500000 })
 *   .sign(process.env.PAYSTACK_SECRET_KEY!);
 *
 * await request(app).post("/webhooks/paystack").set(headers).send(body).expect(200);
 *
 * @example
 * // A payment and its refund, sharing one reference, sent in the wrong order.
 * const [charge, , , processed] = scenario("paystack", "refund", { reference: "ORD-1042" });
 * await processed.send(url, secret);
 * await charge.send(url, secret);
 */

export { buildEvent, fixture, fromPayload, signEvent, webhook } from "./core/build.js";
export type { BuildOptions, FixtureRequest, WebhookFixture } from "./core/build.js";
export { buildScenario, getScenario, listScenarios, scenario } from "./core/scenario.js";
export type { ScenarioOptions } from "./core/scenario.js";
export { deliver } from "./core/send.js";
export type { Deliverable } from "./core/send.js";
export { verifyEndpoint } from "./core/verify.js";
export type { VerifyOptions } from "./core/verify.js";
export { listDeliveries, readReplaySource, recordDelivery, LOG_DIR } from "./core/log.js";
export {
  getEvent,
  getProvider,
  isProviderId,
  listEvents,
  providerIds,
  providers,
} from "./providers/index.js";
export { paystackSignature } from "./providers/paystack.js";
export { PaylocalError } from "./errors.js";
export { version } from "./version.js";
export type {
  BuiltEvent,
  EventContext,
  EventDefinition,
  EventTemplate,
  LogEntry,
  ProbeOutcome,
  Provider,
  ProviderId,
  ScenarioDefinition,
  ScenarioStep,
  SendOptions,
  SendResult,
  ShortcutName,
  ShortcutTarget,
  SignedEvent,
  TamperedRequest,
  Verdict,
  VerifyProbe,
  VerifyResult,
} from "./types.js";
