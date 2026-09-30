import type { EventContext, EventDefinition, Provider } from "../types.js";
import { getPath } from "../util/path.js";

/*
 * Payload shapes follow Flutterwave's v3 webhook documentation:
 * https://developer.flutterwave.com/docs/webhooks
 *
 * Flutterwave v3 does not sign the body. It sends the secret hash you configured
 * in the dashboard in a `verif-hash` header, and your server compares the two.
 */

const iso = (d: Date): string => d.toISOString();

function customer(ctx: EventContext) {
  return {
    id: ctx.id(),
    name: "Ada Okafor",
    phone_number: "+2348012345678",
    email: "ada.okafor@example.com",
    created_at: iso(ctx.now),
  };
}

function charge(ctx: EventContext, status: "successful" | "failed") {
  return {
    id: ctx.id(),
    tx_ref: ctx.ref("tx"),
    flw_ref: `FLW-MOCK-${ctx.code("").slice(1).toUpperCase()}`,
    device_fingerprint: ctx.code("fp"),
    amount: 5_000,
    currency: "NGN",
    charged_amount: 5_000,
    app_fee: 70,
    merchant_fee: 0,
    processor_response: status === "successful" ? "Approved. Successful" : "Insufficient Funds",
    auth_model: "PIN",
    ip: "41.242.49.0",
    narration: "Example Store",
    status,
    payment_type: "card",
    created_at: iso(ctx.now),
    account_id: ctx.id(),
    customer: customer(ctx),
    card: {
      first_6digits: "553188",
      last_4digits: "2950",
      issuer: "MASTERCARD  CREDIT",
      country: "NG",
      type: "MASTERCARD",
      expiry: "09/32",
    },
  };
}

const events: Record<string, EventDefinition> = {
  "charge.completed": {
    name: "charge.completed",
    description: "A charge finished, successfully or not (check data.status)",
    template: (ctx) => ({
      event: "charge.completed",
      data: charge(ctx, "successful"),
      "event.type": "CARD_TRANSACTION",
    }),
  },
  "transfer.completed": {
    name: "transfer.completed",
    description: "A transfer finished, successfully or not (check data.status)",
    template: (ctx) => ({
      event: "transfer.completed",
      "event.type": "Transfer",
      data: {
        id: ctx.id(),
        account_number: "0123456789",
        bank_name: "GUARANTY TRUST BANK",
        bank_code: "058",
        fullname: "Ada Okafor",
        created_at: iso(ctx.now),
        currency: "NGN",
        debit_currency: "NGN",
        amount: 30_000,
        fee: 26.875,
        status: "SUCCESSFUL",
        reference: ctx.ref("trf"),
        meta: null,
        narration: "Vendor payout",
        approver: null,
        complete_message: "Transaction was successful",
        requires_approval: 0,
        is_approved: 1,
      },
    }),
  },
  "refund.completed": {
    name: "refund.completed",
    description: "A refund finished processing",
    template: (ctx) => ({
      event: "refund.completed",
      "event.type": "REFUND",
      data: {
        id: ctx.id(),
        amount_refunded: 5_000,
        status: "completed",
        flw_ref: `FLW-MOCK-${ctx.code("").slice(1).toUpperCase()}`,
        comment: "Customer requested refund",
        settlement_id: null,
        meta: { source: "availablebalance" },
        created_at: iso(ctx.now),
        account_id: ctx.id(),
        tx_id: ctx.id(),
        tx_ref: ctx.ref("tx"),
        customer: customer(ctx),
      },
    }),
  },
  "subscription.cancelled": {
    name: "subscription.cancelled",
    description: "A payment plan subscription was cancelled",
    template: (ctx) => ({
      event: "subscription.cancelled",
      "event.type": "SUBSCRIPTION",
      data: {
        id: ctx.id(),
        amount: 15_000,
        customer: customer(ctx),
        plan: ctx.id(),
        status: "cancelled",
        created_at: iso(ctx.now),
      },
    }),
  },
};

export const flutterwave: Provider = {
  id: "flutterwave",
  name: "Flutterwave",
  secretEnv: "FLUTTERWAVE_SECRET_HASH",
  secretLabel: "secret hash (Settings → Webhooks in the dashboard)",
  signatureHeader: "verif-hash",
  docs: "https://developer.flutterwave.com/docs/webhooks",
  verifyEvent: "charge.completed",
  shortcuts: {
    amount: "data.amount",
    email: "data.customer.email",
    reference: "data.tx_ref",
    currency: "data.currency",
  },
  events,
  sign(_body, secret) {
    return { "verif-hash": secret };
  },
  tamper(body, headers) {
    return {
      body,
      headers: { ...headers, "verif-hash": "paylocal-wrong-hash" },
      description: "verif-hash header replaced with a wrong value",
    };
  },
  summarize(payload) {
    const rows: Array<[string, string]> = [];
    const reference = getPath(payload, "data.tx_ref") ?? getPath(payload, "data.reference");
    const amount = getPath(payload, "data.amount");
    const currency = getPath(payload, "data.currency");
    const email = getPath(payload, "data.customer.email");
    const status = getPath(payload, "data.status");
    if (reference !== undefined) rows.push(["reference", String(reference)]);
    if (amount !== undefined)
      rows.push(["amount", `${String(amount)} ${String(currency ?? "")}`.trim()]);
    if (email !== undefined) rows.push(["customer", String(email)]);
    if (status !== undefined) rows.push(["status", String(status)]);
    return rows;
  },
};
