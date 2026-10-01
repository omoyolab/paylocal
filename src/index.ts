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
 */

export { buildEvent, fromPayload, signEvent, webhook } from "./core/build.js";
export type { BuildOptions, WebhookFixture } from "./core/build.js";
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
  Provider,
  ProviderId,
  SendOptions,
  SendResult,
  SignedEvent,
  TamperedRequest,
  Verdict,
  VerifyResult,
} from "./types.js";
