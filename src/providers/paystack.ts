import { createHmac } from "node:crypto";

import type {
  EventContext,
  EventDefinition,
  Provider,
  ScenarioDefinition,
  ShortcutName,
  ShortcutTarget,
} from "../types.js";
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

function refund(ctx: EventContext, status: "pending" | "processing" | "processed" | "failed") {
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

type Shortcuts = Partial<Record<ShortcutName, ShortcutTarget>>;

/*
 * Where --amount, --email, --reference and --currency land when an event keeps them
 * somewhere other than data.amount, data.customer.email, data.reference and
 * data.currency. `null` means the event has no such field, and asking for it is an error.
 */
const onRefund: Shortcuts = { reference: "data.transaction_reference" };
const onDispute: Shortcuts = {
  reference: "data.transaction.reference",
  amount: ["data.transaction.amount", "data.refund_amount"],
  currency: ["data.currency", "data.transaction.currency"],
};
const onInvoice: Shortcuts = {
  reference: "data.transaction.reference",
  amount: ["data.amount", "data.transaction.amount"],
  currency: "data.transaction.currency",
};
const onSubscription: Shortcuts = {
  reference: null,
  amount: ["data.amount", "data.plan.amount"],
  currency: "data.plan.currency",
};
const onTransfer: Shortcuts = { email: null };
const onIdentification: Shortcuts = {
  email: "data.email",
  amount: null,
  reference: null,
  currency: null,
};
const onDedicatedAccount: Shortcuts = { amount: null, reference: null, currency: null };
const onPaymentRequest: Shortcuts = { email: null, reference: null };

const events: Record<string, EventDefinition> = {
  "charge.success": {
    name: "charge.success",
    description: "A customer's payment was successful",
    shortcuts: { amount: ["data.amount", "data.requested_amount"] },
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
    shortcuts: onDispute,
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
    shortcuts: onTransfer,
    description: "A transfer to a bank account succeeded",
    template: (ctx) => ({ event: "transfer.success", data: transfer(ctx, "success") }),
  },
  "transfer.failed": {
    name: "transfer.failed",
    shortcuts: onTransfer,
    description: "A transfer to a bank account failed",
    template: (ctx) => ({ event: "transfer.failed", data: transfer(ctx, "failed") }),
  },
  "transfer.reversed": {
    name: "transfer.reversed",
    shortcuts: onTransfer,
    description: "A transfer was reversed and funds returned to your balance",
    template: (ctx) => ({ event: "transfer.reversed", data: transfer(ctx, "reversed") }),
  },
  "subscription.create": {
    name: "subscription.create",
    shortcuts: onSubscription,
    description: "A subscription was created for a customer",
    template: (ctx) => ({ event: "subscription.create", data: subscription(ctx, "active") }),
  },
  "subscription.disable": {
    name: "subscription.disable",
    shortcuts: onSubscription,
    description: "A subscription was disabled",
    template: (ctx) => ({ event: "subscription.disable", data: subscription(ctx, "complete") }),
  },
  "subscription.not_renew": {
    name: "subscription.not_renew",
    shortcuts: onSubscription,
    description: "A subscription was set to not renew at the end of the period",
    template: (ctx) => ({
      event: "subscription.not_renew",
      data: subscription(ctx, "non-renewing"),
    }),
  },
  "invoice.create": {
    name: "invoice.create",
    shortcuts: onInvoice,
    description: "An invoice was created ahead of a subscription charge",
    template: (ctx) => ({ event: "invoice.create", data: invoice(ctx, "pending") }),
  },
  "invoice.update": {
    name: "invoice.update",
    shortcuts: onInvoice,
    description: "An invoice was updated after a charge attempt",
    template: (ctx) => ({ event: "invoice.update", data: invoice(ctx, "success") }),
  },
  "invoice.payment_failed": {
    name: "invoice.payment_failed",
    shortcuts: onInvoice,
    description: "A subscription charge failed",
    template: (ctx) => ({ event: "invoice.payment_failed", data: invoice(ctx, "failed") }),
  },
  "refund.pending": {
    name: "refund.pending",
    shortcuts: onRefund,
    description: "A refund was initiated and is awaiting processing",
    template: (ctx) => ({ event: "refund.pending", data: refund(ctx, "pending") }),
  },
  "refund.processing": {
    name: "refund.processing",
    shortcuts: onRefund,
    description: "A refund was received by the processor",
    template: (ctx) => ({ event: "refund.processing", data: refund(ctx, "processing") }),
  },
  "refund.processed": {
    name: "refund.processed",
    shortcuts: onRefund,
    description: "A refund was processed and sent to the customer",
    template: (ctx) => ({ event: "refund.processed", data: refund(ctx, "processed") }),
  },
  "refund.failed": {
    name: "refund.failed",
    shortcuts: onRefund,
    description: "A refund could not be processed",
    template: (ctx) => ({ event: "refund.failed", data: refund(ctx, "failed") }),
  },
  "customeridentification.success": {
    name: "customeridentification.success",
    shortcuts: onIdentification,
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
    shortcuts: onIdentification,
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
    shortcuts: onDedicatedAccount,
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
    shortcuts: onDedicatedAccount,
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
    shortcuts: onPaymentRequest,
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
    shortcuts: onPaymentRequest,
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

/** What a refund notice takes from the charge it refunds, and from any earlier refund notice. */
function refundOf(first: Record<string, unknown>, previous: Record<string, unknown>[]) {
  const earlier = previous.find((payload) => String(payload.event).startsWith("refund."));
  return {
    "data.transaction_reference": getPath(first, "data.reference"),
    "data.amount": getPath(first, "data.amount"),
    "data.currency": getPath(first, "data.currency"),
    "data.customer.first_name": getPath(first, "data.customer.first_name"),
    "data.customer.last_name": getPath(first, "data.customer.last_name"),
    "data.customer.email": getPath(first, "data.customer.email"),
    // Every notice about one refund carries the same refund reference.
    ...(earlier ? { "data.refund_reference": getPath(earlier, "data.refund_reference") } : {}),
  };
}

const scenarios: Record<string, ScenarioDefinition> = {
  payment: {
    name: "payment",
    description: "A customer pays",
    steps: [{ event: "charge.success" }],
  },
  refund: {
    name: "refund",
    description: "A customer pays, then the payment is refunded in full",
    steps: [
      { event: "charge.success" },
      { event: "refund.pending", link: refundOf },
      { event: "refund.processing", link: refundOf },
      { event: "refund.processed", link: refundOf },
    ],
  },
  "refund-failed": {
    name: "refund-failed",
    description: "A customer pays, then a refund is tried and fails",
    steps: [
      { event: "charge.success" },
      { event: "refund.pending", link: refundOf },
      { event: "refund.failed", link: refundOf },
    ],
  },
  dispute: {
    name: "dispute",
    description: "A customer pays, then their bank disputes the payment",
    steps: [
      { event: "charge.success" },
      {
        event: "charge.dispute.create",
        link: (first) => ({
          "data.transaction.id": getPath(first, "data.id"),
          "data.transaction.reference": getPath(first, "data.reference"),
          "data.transaction.amount": getPath(first, "data.amount"),
          "data.transaction.currency": getPath(first, "data.currency"),
          "data.transaction.paid_at": getPath(first, "data.paid_at"),
          "data.refund_amount": getPath(first, "data.amount"),
          "data.currency": getPath(first, "data.currency"),
          "data.customer": getPath(first, "data.customer"),
        }),
      },
    ],
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
  amountUnit: "kobo, the smallest unit",
  signsBody: true,
  events,
  scenarios,
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
    const amount = getPath(payload, "data.amount") ?? getPath(payload, "data.transaction.amount");
    const currency = getPath(payload, "data.currency");
    const reference =
      getPath(payload, "data.reference") ??
      getPath(payload, "data.transaction_reference") ??
      getPath(payload, "data.transaction.reference");
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
