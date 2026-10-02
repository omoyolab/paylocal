import { afterEach, describe, expect, it } from "vitest";

import { verifyEndpoint } from "../src/core/verify.js";
import { paystackSignature } from "../src/providers/paystack.js";
import { startServer, type TestServer } from "./helpers/server.js";

const secret = "sk_test_verify";
let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("verifyEndpoint", () => {
  it("reports verified when only correctly signed requests are accepted", async () => {
    server = await startServer((req) => {
      const expected = paystackSignature(req.body, secret);
      return req.headers["x-paystack-signature"] === expected ? { status: 200 } : { status: 401 };
    });
    const result = await verifyEndpoint("paystack", server.url, secret);
    expect(result.verdict).toBe("verified");
    expect(result.valid.ok).toBe(true);
    expect(result.tampered.ok).toBe(false);
    expect(result.event).toBe("charge.success");
    expect(server.requests).toHaveLength(4);
    expect(result.probes.map((probe) => [probe.name, probe.outcome])).toEqual([
      ["no-signature", "rejected"],
      ["wrong-secret", "rejected"],
      ["changed-body", "rejected"],
    ]);
  });

  it("sends a request with no signature header, and one signed with another secret", async () => {
    server = await startServer(() => ({ status: 401 }));
    await verifyEndpoint("paystack", server.url, secret);
    const [valid, bare, wrong, changed] = server.requests;
    expect(valid!.headers["x-paystack-signature"]).toBe(paystackSignature(valid!.body, secret));
    expect(bare!.headers["x-paystack-signature"]).toBeUndefined();
    expect(bare!.body).toBe(valid!.body);
    expect(wrong!.headers["x-paystack-signature"]).toHaveLength(128);
    expect(wrong!.headers["x-paystack-signature"]).not.toBe(valid!.headers["x-paystack-signature"]);
    expect(changed!.body).not.toBe(valid!.body);
    expect(changed!.headers["x-paystack-signature"]).toBe(valid!.headers["x-paystack-signature"]);
  });

  it("reports not-verified when the endpoint checks the signature only if one is sent", async () => {
    server = await startServer((req) => {
      const sent = req.headers["x-paystack-signature"];
      if (sent === undefined) return { status: 200 };
      return sent === paystackSignature(req.body, secret) ? { status: 200 } : { status: 401 };
    });
    const result = await verifyEndpoint("paystack", server.url, secret);
    expect(result.verdict).toBe("not-verified");
    expect(result.probes[0]).toMatchObject({ name: "no-signature", outcome: "accepted" });
    expect(result.notes[0]).toMatch(/accepted a request with no x-paystack-signature header/);
  });

  it("reports not-verified when a forged request makes the endpoint answer 500", async () => {
    server = await startServer((req) => {
      const sent = req.headers["x-paystack-signature"];
      if (sent === undefined) return { status: 500 };
      return sent === paystackSignature(req.body, secret) ? { status: 200 } : { status: 401 };
    });
    const result = await verifyEndpoint("paystack", server.url, secret);
    expect(result.verdict).toBe("not-verified");
    expect(result.probes[0]).toMatchObject({ name: "no-signature", outcome: "crashed" });
    expect(result.notes.join(" ")).toMatch(
      /answered HTTP 500 .* It broke where it should have refused/,
    );
  });

  it("sends two forged requests to a provider that does not sign the body", async () => {
    server = await startServer((req) =>
      req.headers["verif-hash"] === "hash" ? { status: 200 } : { status: 401 },
    );
    const result = await verifyEndpoint("flutterwave", server.url, "hash");
    expect(result.probes.map((probe) => probe.name)).toEqual(["no-signature", "wrong-secret"]);
    expect(server.requests[1]!.headers["verif-hash"]).toBeUndefined();
    expect(server.requests[2]!.headers["verif-hash"]).not.toBe("hash");
  });

  it("reports not-verified when the endpoint accepts anything", async () => {
    server = await startServer(() => ({ status: 200 }));
    const result = await verifyEndpoint("paystack", server.url, secret);
    expect(result.verdict).toBe("not-verified");
    expect(result.notes.join(" ")).toMatch(/fake a Paystack event/);
  });

  it("reports inconclusive when even the valid event is rejected", async () => {
    server = await startServer(() => ({ status: 500 }));
    const result = await verifyEndpoint("paystack", server.url, secret);
    expect(result.verdict).toBe("inconclusive");
    expect(result.notes[0]).toMatch(/--secret/);
  });

  it("works for flutterwave's shared-hash scheme", async () => {
    server = await startServer((req) =>
      req.headers["verif-hash"] === "hash" ? { status: 200 } : { status: 401 },
    );
    const result = await verifyEndpoint("flutterwave", server.url, "hash");
    expect(result.verdict).toBe("verified");
    expect(result.event).toBe("charge.completed");
    expect(result.notes.join(" ")).toMatch(/verify-transaction/);
  });

  it("honors a custom event", async () => {
    server = await startServer(() => ({ status: 200 }));
    const result = await verifyEndpoint("paystack", server.url, secret, {
      event: "transfer.success",
    });
    expect(result.event).toBe("transfer.success");
    expect(JSON.parse(server.requests[0]!.body).event).toBe("transfer.success");
  });
});
