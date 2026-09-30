import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { paystack, paystackSignature } from "../src/providers/paystack.js";
import { createContext } from "../src/util/random.js";

const secret = "sk_test_0123456789abcdef";

describe("paystack signature", () => {
  it("is an HMAC-SHA512 hex digest of the raw body", () => {
    const body = '{"event":"charge.success"}';
    const expected = createHmac("sha512", secret).update(body).digest("hex");
    expect(paystackSignature(body, secret)).toBe(expected);
    expect(paystack.sign(body, secret)).toEqual({ "x-paystack-signature": expected });
  });

  it("changes when the body changes", () => {
    expect(paystackSignature("a", secret)).not.toBe(paystackSignature("b", secret));
  });
});

describe("paystack tamper", () => {
  it("keeps the signature but changes the body so verification fails", () => {
    const body = '{"event":"charge.success","data":{"amount":1}}';
    const headers = paystack.sign(body, secret);
    const tampered = paystack.tamper(body, headers);
    expect(tampered.headers).toEqual(headers);
    expect(tampered.body).not.toBe(body);
    expect(JSON.parse(tampered.body)).toMatchObject({
      event: "charge.success",
      paylocal_tampered: true,
    });
    expect(paystackSignature(tampered.body, secret)).not.toBe(headers["x-paystack-signature"]);
  });
});

describe("paystack events", () => {
  const ctx = createContext(new Date("2026-01-15T10:00:00.000Z"));

  it.each(Object.keys(paystack.events))(
    "%s produces a payload whose event field matches",
    (name) => {
      const definition = paystack.events[name]!;
      const payload = definition.template(ctx);
      expect(definition.name).toBe(name);
      expect(payload.event).toBe(name);
      expect(payload.data).toBeDefined();
      expect(definition.description.length).toBeGreaterThan(10);
      expect(() => JSON.stringify(payload)).not.toThrow();
    },
  );

  it("charge.success carries the fields most integrations read", () => {
    const payload = paystack.events["charge.success"]!.template(ctx) as {
      data: Record<string, unknown> & { customer: Record<string, unknown> };
    };
    expect(payload.data.status).toBe("success");
    expect(payload.data.currency).toBe("NGN");
    expect(typeof payload.data.reference).toBe("string");
    expect(typeof payload.data.amount).toBe("number");
    expect(payload.data.customer.email).toBe("ada.okafor@example.com");
    expect(payload.data.paid_at).toBe("2026-01-15T10:00:00.000Z");
  });

  it("generates different references on each call", () => {
    const a = paystack.events["charge.success"]!.template(ctx) as { data: { reference: string } };
    const b = paystack.events["charge.success"]!.template(ctx) as { data: { reference: string } };
    expect(a.data.reference).not.toBe(b.data.reference);
  });

  it("summarize picks the headline fields", () => {
    const payload = paystack.events["charge.success"]!.template(ctx);
    const rows = Object.fromEntries(paystack.summarize(payload));
    expect(rows.amount).toBe("500000 NGN");
    expect(rows.customer).toBe("ada.okafor@example.com");
    expect(rows.status).toBe("success");
  });
});
