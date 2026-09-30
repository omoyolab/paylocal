import { describe, expect, it } from "vitest";

import { flutterwave } from "../src/providers/flutterwave.js";
import { createContext } from "../src/util/random.js";

const secret = "my-dashboard-secret-hash";

describe("flutterwave signature", () => {
  it("sends the secret hash verbatim in verif-hash", () => {
    expect(flutterwave.sign("{}", secret)).toEqual({ "verif-hash": secret });
  });

  it("tamper replaces the hash and leaves the body alone", () => {
    const body = '{"event":"charge.completed"}';
    const headers = flutterwave.sign(body, secret);
    const tampered = flutterwave.tamper(body, headers);
    expect(tampered.body).toBe(body);
    expect(tampered.headers["verif-hash"]).not.toBe(secret);
  });
});

describe("flutterwave events", () => {
  const ctx = createContext(new Date("2026-01-15T10:00:00.000Z"));

  it.each(Object.keys(flutterwave.events))(
    "%s produces a payload whose event field matches",
    (name) => {
      const definition = flutterwave.events[name]!;
      const payload = definition.template(ctx);
      expect(definition.name).toBe(name);
      expect(payload.event).toBe(name);
      expect(payload.data).toBeDefined();
      expect(() => JSON.stringify(payload)).not.toThrow();
    },
  );

  it("charge.completed carries tx_ref, status and customer", () => {
    const payload = flutterwave.events["charge.completed"]!.template(ctx) as {
      data: { tx_ref: string; status: string; customer: { email: string } };
    };
    expect(payload.data.tx_ref).toMatch(/^tx_/);
    expect(payload.data.status).toBe("successful");
    expect(payload.data.customer.email).toBe("ada.okafor@example.com");
  });

  it("summarize uses tx_ref as the reference", () => {
    const payload = flutterwave.events["charge.completed"]!.template(ctx);
    const rows = Object.fromEntries(flutterwave.summarize(payload));
    expect(rows.reference).toMatch(/^tx_/);
    expect(rows.amount).toBe("5000 NGN");
  });
});
