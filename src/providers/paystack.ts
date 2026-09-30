import { createHmac } from "node:crypto";

import type { EventContext, EventDefinition, Provider } from "../types.js";
import { getPath } from "../util/path.js";

/*
 * Payload shapes follow Paystack's webhook documentation:
 * https://paystack.com/docs/payments/webhooks/
 *
 * Every template gets fresh ids, references and timestamps on each call.
 * Field values can be overridden from the CLI with `--set path=value`.
 */

const iso = (d: Date): string => d.toISOString();

function customer(ctx: EventContext) {
  return {
    id: ctx.id(),
    first_name: "Ada",
    last_name: "Okafor",
    email: "ada.okafor@example.com",
    customer_code: ctx.code("CUS"),
    phone: "+2348012345678",
    metadata: {},
    risk_action: "default",
    international_format_phone: "+2348012345678",
  };
}

function authorization(ctx: EventContext) {
  return {
    authorization_code: ctx.code("AUTH"),
    bin: "408408",
    last4: "4081",
    exp_month: "12",
    exp_year: "2030",
    channel: "card",
    card_type: "visa",
    bank: "TEST BANK",
    country_code: "NG",
    brand: "visa",
    reusable: true,
    signature: ctx.code("SIG"),
    account_name: null,
  };
}

function recipient(ctx: EventContext) {
  return {
    active: true,
    currency: "NGN",
    description: "",
    domain: "test",
    email: null,
    id: ctx.id(),
    integration: ctx.id(),
    metadata: null,
    name: "Ada Okafor",
    recipient_code: ctx.code("RCP"),
    type: "nuban",
    is_deleted: false,
    details: {
      account_number: "0123456789",
      account_name: "ADA OKAFOR",
      bank_code: "058",
      bank_name: "Guaranty Trust Bank",
    },
    created_at: iso(ctx.now),
    updated_at: iso(ctx.now),
  };
}

function transfer(ctx: EventContext, status: "success" | "failed" | "reversed") {
  const reasonByStatus = {
    success: null,
    failed: "Transfer failed. Please try again.",
    reversed: "Transfer was reversed by the bank.",
  } as const;
  return {
    amount: 30_000,
    currency: "NGN",
    domain: "test",
    failures: null,
    id: ctx.id(),
    integration: {
      id: ctx.id(),
      is_live: false,
      business_name: "Example Store",
    },
    reason: "Vendor payout",
    reference: ctx.ref("trf"),
    source: "balance",
    source_details: null,
    status,
    titan_code: null,
    transfer_code: ctx.code("TRF"),
    transferred_at: status === "success" ? iso(ctx.now) : null,
    recipient: recipient(ctx),
    session: { provider: null, id: null },
    gateway_response: reasonByStatus[status],
    created_at: iso(ctx.now),
    updated_at: iso(ctx.now),
  };
}

function plan(ctx: EventContext) {
  return {
    id: ctx.id(),
    name: "Pro Monthly",
    plan_code: ctx.code("PLN"),
    description: null,
    amount: 1_500_000,
    interval: "monthly",
    send_invoices: true,
    send_sms: true,
    currency: "NGN",
  };
}

function subscription(ctx: EventContext, status: "active" | "complete" | "non-renewing") {
  return {
    domain: "test",
    status,
    subscription_code: ctx.code("SUB"),
    email_token: ctx.code("tok"),
    amount: 1_500_000,
    cron_expression: "0 0 28 * *",
    next_payment_date: status === "active" ? iso(ctx.now) : null,
    open_invoice: null,
    created_at: iso(ctx.now),
    plan: plan(ctx),
    authorization: authorization(ctx),
    customer: customer(ctx),
  };
}

function invoice(ctx: EventContext, status: "pending" | "success" | "failed") {
  return {
    domain: "test",
    invoice_code: ctx.code("INV"),
    amount: 1_500_000,
    period_start: iso(ctx.now),
    period_end: iso(new Date(ctx.now.getTime() + 30 * 24 * 60 * 60 * 1000)),
    status,
    paid: status === "success",
    paid_at: status === "success" ? iso(ctx.now) : null,
    description: null,
    authorization: authorization(ctx),
    subscription: {
      status: "active",
      subscription_code: ctx.code("SUB"),
      email_token: ctx.code("tok"),
      amount: 1_500_000,
      cron_expression: "0 0 28 * *",
      next_payment_date: iso(ctx.now),
      open_invoice: null,
    },
    customer: customer(ctx),
    transaction: {
      reference: ctx.ref(),
      status: status === "success" ? "success" : "failed",
      amount: 1_500_000,
      currency: "NGN",
    },
    created_at: iso(ctx.now),
  };
}

function refund(ctx: EventContext, status: "pending" | "processed" | "failed") {
  return {
    status,
    transaction_reference: ctx.ref(),
    refund_reference: ctx.ref("rfd"),
    amount: 250_000,
    currency: "NGN",
    processor: "card",
    customer: {
      first_name: "Ada",
      last_name: "Okafor",
      email: "ada.okafor@example.com",
    },
    integration: ctx.id(),
    domain: "test",
    created_at: iso(ctx.now),
  };
}

const events: Record<string, EventDefinition> = {
  "charge.success": {
    name: "charge.success",
    description: "A customer's payment was successful",
    template: (ctx) => ({
      event: "charge.success",
      data: {
        id: ctx.id(),
        domain: "test",
        status: "success",
        reference: ctx.ref(),
        amount: 500_000,
        message: null,
        gateway_response: "Approved",
        paid_at: iso(ctx.now),
        created_at: iso(ctx.now),
        channel: "card",
        currency: "NGN",
        ip_address: "41.242.49.0",
        metadata: {},
        fees: 7_500,
        fees_split: null,
        log: null,
        customer: customer(ctx),
        authorization: authorization(ctx),
        plan: {},
        subaccount: {},
        split: {},
        order_id: null,
        paidAt: iso(ctx.now),
        requested_amount: 500_000,
        pos_transaction_data: null,
        source: {
          type: "api",
          source: "merchant_api",
          entry_point: "transaction_initialize",
          identifier: null,
        },
      },
    }),
  },
  "charge.dispute.create": {
    name: "charge.dispute.create",
    description: "A customer opened a chargeback dispute",
    template: (ctx) => ({
      event: "charge.dispute.create",
      data: {
        id: ctx.id(),
        refund_amount: 500_000,
        currency: "NGN",
        status: "awaiting-merchant-feedback",
        resolution: null,
        domain: "test",
        transaction: {
          id: ctx.id(),
          reference: ctx.ref(),
          amount: 500_000,
          currency: "NGN",
          status: "success",
          paid_at: iso(ctx.now),
        },
        category: "chargeback",
        customer: customer(ctx),
        bin: "408408",
        last4: "4081",
        dueAt: iso(new Date(ctx.now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        resolvedAt: null,
        evidence: null,
        attachments: null,
        note: null,
        history: [],
        messages: [],
        created_at: iso(ctx.now),
        updated_at: iso(ctx.now),
      },
    }),
  },
  "transfer.success": {
    name: "transfer.success",
    description: "A transfer to a bank account succeeded",
    template: (ctx) => ({ event: "transfer.success", data: transfer(ctx, "success") }),
  },
  "transfer.failed": {
    name: "transfer.failed",
    description: "A transfer to a bank account failed",
    template: (ctx) => ({ event: "transfer.failed", data: transfer(ctx, "failed") }),
  },
  "transfer.reversed": {
    name: "transfer.reversed",
    description: "A transfer was reversed and funds returned to your balance",
    template: (ctx) => ({ event: "transfer.reversed", data: transfer(ctx, "reversed") }),
  },
  "subscription.create": {
    name: "subscription.create",
    description: "A subscription was created for a customer",
    template: (ctx) => ({ event: "subscription.create", data: subscription(ctx, "active") }),
  },
  "subscription.disable": {
    name: "subscription.disable",
    description: "A subscription was disabled",
    template: (ctx) => ({ event: "subscription.disable", data: subscription(ctx, "complete") }),
  },
  "subscription.not_renew": {
    name: "subscription.not_renew",
    description: "A subscription was set to not renew at the end of the period",
    template: (ctx) => ({
      event: "subscription.not_renew",
      data: subscription(ctx, "non-renewing"),
    }),
  },
  "invoice.create": {
    name: "invoice.create",
    description: "An invoice was created ahead of a subscription charge",
    template: (ctx) => ({ event: "invoice.create", data: invoice(ctx, "pending") }),
  },
  "invoice.update": {
    name: "invoice.update",
    description: "An invoice was updated after a charge attempt",
    template: (ctx) => ({ event: "invoice.update", data: invoice(ctx, "success") }),
  },
  "invoice.payment_failed": {
    name: "invoice.payment_failed",
    description: "A subscription charge failed",
    template: (ctx) => ({ event: "invoice.payment_failed", data: invoice(ctx, "failed") }),
  },
  "refund.pending": {
    name: "refund.pending",
    description: "A refund was initiated and is awaiting processing",
    template: (ctx) => ({ event: "refund.pending", data: refund(ctx, "pending") }),
  },
  "refund.processed": {
    name: "refund.processed",
    description: "A refund was processed and sent to the customer",
    template: (ctx) => ({ event: "refund.processed", data: refund(ctx, "processed") }),
  },
  "refund.failed": {
    name: "refund.failed",
    description: "A refund could not be processed",
    template: (ctx) => ({ event: "refund.failed", data: refund(ctx, "failed") }),
  },
  "customeridentification.success": {
    name: "customeridentification.success",
    description: "A customer's identity was validated",
    template: (ctx) => ({
      event: "customeridentification.success",
      data: {
        customer_id: ctx.id(),
        customer_code: ctx.code("CUS"),
        email: "ada.okafor@example.com",
        identification: {
          country: "NG",
          type: "bank_account",
          bvn: "222***1234",
          account_number: "012***6789",
          bank_code: "058",
        },
      },
    }),
  },
  "customeridentification.failed": {
    name: "customeridentification.failed",
    description: "A customer's identity could not be validated",
    template: (ctx) => ({
      event: "customeridentification.failed",
      data: {
        customer_id: ctx.id(),
        customer_code: ctx.code("CUS"),
        email: "ada.okafor@example.com",
        identification: {
          country: "NG",
          type: "bank_account",
          bvn: "222***1234",
          account_number: "012***6789",
          bank_code: "058",
        },
        reason: "Account number or BVN is incorrect",
      },
    }),
  },
  "dedicatedaccount.assign.success": {
    name: "dedicatedaccount.assign.success",
    description: "A dedicated virtual account was assigned to a customer",
    template: (ctx) => ({
      event: "dedicatedaccount.assign.success",
      data: {
        customer: customer(ctx),
        dedicated_account: {
          bank: { name: "Wema Bank", id: 20, slug: "wema-bank" },
          account_name: "PAYSTACK-EXAMPLE STORE",
          account_number: "7812345678",
          assigned: true,
          currency: "NGN",
          metadata: null,
          active: true,
          id: ctx.id(),
          created_at: iso(ctx.now),
          updated_at: iso(ctx.now),
          assignment: {
            integration: ctx.id(),
            assignee_id: ctx.id(),
            assignee_type: "Customer",
            expired: false,
            account_type: "PAY-WITH-TRANSFER-RECURRING",
            assigned_at: iso(ctx.now),
          },
        },
        identification: { status: "success" },
      },
    }),
  },
  "dedicatedaccount.assign.failed": {
    name: "dedicatedaccount.assign.failed",
    description: "A dedicated virtual account could not be assigned",
    template: (ctx) => ({
      event: "dedicatedaccount.assign.failed",
      data: {
        customer: customer(ctx),
        dedicated_account: null,
        identification: { status: "failed" },
      },
    }),
  },
  "paymentrequest.pending": {
    name: "paymentrequest.pending",
    description: "A payment request (invoice) was sent to a customer",
    template: (ctx) => ({
      event: "paymentrequest.pending",
      data: {
        id: ctx.id(),
        domain: "test",
        amount: 1_000_000,
        currency: "NGN",
        due_date: iso(new Date(ctx.now.getTime() + 7 * 24 * 60 * 60 * 1000)),
        has_invoice: true,
        invoice_number: 1,
        description: "Website redesign",
        pdf_url: null,
        line_items: [{ name: "Design", amount: 1_000_000, quantity: 1 }],
        tax: [],
        request_code: ctx.code("PRQ"),
        status: "pending",
        paid: false,
        paid_at: null,
        metadata: null,
        notifications: [],
        offline_reference: `${ctx.id()}`,
        customer: ctx.id(),
        created_at: iso(ctx.now),
      },
    }),
  },
  "paymentrequest.success": {
    name: "paymentrequest.success",
    description: "A payment request (invoice) was paid",
    template: (ctx) => ({
      event: "paymentrequest.success",
      data: {
        id: ctx.id(),
        domain: "test",
        amount: 1_000_000,
        currency: "NGN",
        due_date: iso(ctx.now),
        has_invoice: true,
        invoice_number: 1,
        description: "Website redesign",
        pdf_url: null,
        line_items: [{ name: "Design", amount: 1_000_000, quantity: 1 }],
        tax: [],
        request_code: ctx.code("PRQ"),
        status: "success",
        paid: true,
        paid_at: iso(ctx.now),
        metadata: null,
        notifications: [],
        offline_reference: `${ctx.id()}`,
        customer: ctx.id(),
        created_at: iso(ctx.now),
      },
    }),
  },
};

/** HMAC-SHA512 of the raw body, hex encoded, keyed with your secret key. */
export function paystackSignature(body: string, secret: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

export const paystack: Provider = {
  id: "paystack",
  name: "Paystack",
  secretEnv: "PAYSTACK_SECRET_KEY",
  secretLabel: "secret key (sk_test_... or sk_live_...)",
  signatureHeader: "x-paystack-signature",
  docs: "https://paystack.com/docs/payments/webhooks/",
  verifyEvent: "charge.success",
  shortcuts: {
    amount: "data.amount",
    email: "data.customer.email",
    reference: "data.reference",
    currency: "data.currency",
  },
  events,
  sign(body, secret) {
    return { "x-paystack-signature": paystackSignature(body, secret) };
  },
  tamper(body, headers) {
    // Keep the original signature but change the body so the HMAC no longer matches.
    const tampered = body.replace(/^\{/, '{"paylocal_tampered":true,');
    return {
      body: tampered,
      headers,
      description: "body changed after signing, original signature kept",
    };
  },
  summarize(payload) {
    const rows: Array<[string, string]> = [];
    const amount = getPath(payload, "data.amount");
    const currency = getPath(payload, "data.currency");
    const reference = getPath(payload, "data.reference");
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
