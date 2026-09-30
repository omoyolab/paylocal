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
    expect(server.requests).toHaveLength(2);
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
