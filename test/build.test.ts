import { describe, expect, it } from "vitest";

import { buildEvent, fromPayload, signEvent, webhook } from "../src/core/build.js";
import { PaylocalError } from "../src/errors.js";
import { paystackSignature } from "../src/providers/paystack.js";
import { coerce, getPath, parseAssignment, setPath } from "../src/util/path.js";

describe("buildEvent", () => {
  it("builds a paystack event with a compact JSON body", () => {
    const built = buildEvent("paystack", "charge.success");
    expect(built.provider).toBe("paystack");
    expect(built.event).toBe("charge.success");
    expect(JSON.parse(built.body)).toEqual(built.payload);
    expect(built.body).not.toContain("\n");
  });

  it("applies shortcuts to provider-specific paths", () => {
    const ps = buildEvent("paystack", "charge.success", {
      amount: 250_000,
      email: "x@example.com",
      reference: "order-1",
      currency: "GHS",
    });
    expect(getPath(ps.payload, "data.amount")).toBe(250_000);
    expect(getPath(ps.payload, "data.customer.email")).toBe("x@example.com");
    expect(getPath(ps.payload, "data.reference")).toBe("order-1");
    expect(getPath(ps.payload, "data.currency")).toBe("GHS");

    const fw = buildEvent("flutterwave", "charge.completed", { reference: "order-2" });
    expect(getPath(fw.payload, "data.tx_ref")).toBe("order-2");
  });

  it("applies arbitrary --set overrides after shortcuts", () => {
    const built = buildEvent("paystack", "charge.success", {
      amount: 1,
      set: { "data.amount": 2, "data.metadata.order_id": "abc", "data.brand_new.nested": true },
    });
    expect(getPath(built.payload, "data.amount")).toBe(2);
    expect(getPath(built.payload, "data.metadata.order_id")).toBe("abc");
    expect(getPath(built.payload, "data.brand_new.nested")).toBe(true);
  });

  it("uses a fixed timestamp when given", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    const built = buildEvent("paystack", "charge.success", { now });
    expect(getPath(built.payload, "data.paid_at")).toBe(now.toISOString());
  });

  it("rejects unknown providers and events with hints", () => {
    expect(() => buildEvent("stripe", "x")).toThrow(PaylocalError);
    expect(() => buildEvent("paystack", "nope")).toThrow(/Unknown Paystack event/);
  });
});

describe("signEvent", () => {
  it("signs the exact body string", () => {
    const signed = signEvent(buildEvent("paystack", "charge.success"), "sk_test_1");
    expect(signed.headers["x-paystack-signature"]).toBe(
      paystackSignature(signed.body, "sk_test_1"),
    );
  });

  it("refuses an empty secret", () => {
    expect(() => signEvent(buildEvent("paystack", "charge.success"), "")).toThrow(PaylocalError);
  });
});

describe("fromPayload", () => {
  it("wraps a stored payload without regenerating it", () => {
    const payload = { event: "charge.success", data: { amount: 42 } };
    const built = fromPayload("paystack", payload);
    expect(built.event).toBe("charge.success");
    expect(built.body).toBe(JSON.stringify(payload));
  });
});

describe("webhook fixture helper", () => {
  it("returns body and headers ready for an HTTP client", () => {
    const fixture = webhook("paystack", "transfer.success", { amount: 10 });
    const { body, headers } = fixture.sign("sk_test_2");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["x-paystack-signature"]).toBe(paystackSignature(body, "sk_test_2"));
    expect(JSON.parse(body).data.amount).toBe(10);
  });
});

describe("path helpers", () => {
  it("setPath creates intermediate objects and overwrites non-objects", () => {
    const target: Record<string, unknown> = { a: 1 };
    setPath(target, "a.b.c", 5);
    setPath(target, "x", "y");
    expect(target).toEqual({ a: { b: { c: 5 } }, x: "y" });
    expect(() => setPath(target, "", 1)).toThrow(PaylocalError);
  });

  it("coerce turns CLI strings into JSON values", () => {
    expect(coerce("true")).toBe(true);
    expect(coerce("false")).toBe(false);
    expect(coerce("null")).toBeNull();
    expect(coerce("5000")).toBe(5000);
    expect(coerce("-1.5")).toBe(-1.5);
    expect(coerce('"12345"')).toBe("12345");
    expect(coerce('{"a":1}')).toEqual({ a: 1 });
    expect(coerce("[1,2]")).toEqual([1, 2]);
    expect(coerce("{not json")).toBe("{not json");
    expect(coerce("ada@example.com")).toBe("ada@example.com");
  });

  it("parseAssignment splits on the first equals sign", () => {
    expect(parseAssignment("data.amount=5000")).toEqual(["data.amount", 5000]);
    expect(parseAssignment("data.note=a=b")).toEqual(["data.note", "a=b"]);
    expect(() => parseAssignment("nope")).toThrow(PaylocalError);
    expect(() => parseAssignment("=1")).toThrow(PaylocalError);
  });
});
