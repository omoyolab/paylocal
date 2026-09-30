import { afterEach, describe, expect, it } from "vitest";

import { buildEvent, signEvent } from "../src/core/build.js";
import { deliver } from "../src/core/send.js";
import { PaylocalError } from "../src/errors.js";
import { startServer, type TestServer } from "./helpers/server.js";

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("deliver", () => {
  it("posts the body with the signature and content-type headers", async () => {
    server = await startServer(() => ({ status: 200, body: '{"received":true}' }));
    const signed = signEvent(buildEvent("paystack", "charge.success"), "sk_test_1");

    const result = await deliver(signed, `${server.url}/webhooks/paystack`);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.responseBody).toBe('{"received":true}');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const request = server.requests[0]!;
    expect(request.method).toBe("POST");
    expect(request.url).toBe("/webhooks/paystack");
    expect(request.body).toBe(signed.body);
    expect(request.headers["content-type"]).toBe("application/json");
    expect(request.headers["x-paystack-signature"]).toBe(signed.headers["x-paystack-signature"]);
    expect(request.headers["user-agent"]).toMatch(/^paylocal\//);
  });

  it("reports non-2xx responses without throwing", async () => {
    server = await startServer(() => ({ status: 401, body: "bad signature" }));
    const signed = signEvent(buildEvent("flutterwave", "charge.completed"), "hash");
    const result = await deliver(signed, server.url);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.responseBody).toBe("bad signature");
  });

  it("explains connection failures", async () => {
    const signed = signEvent(buildEvent("paystack", "charge.success"), "sk_test_1");
    await expect(deliver(signed, "http://127.0.0.1:1/webhooks")).rejects.toThrow(
      /Could not connect/,
    );
  });

  it("rejects invalid URLs with a hint", async () => {
    const signed = signEvent(buildEvent("paystack", "charge.success"), "sk_test_1");
    await expect(deliver(signed, "localhost:3000")).rejects.toThrow(PaylocalError);
  });

  it("times out slow endpoints", async () => {
    server = await startServer(
      () => new Promise((resolve) => setTimeout(() => resolve({ status: 200 }), 300)),
    );
    const signed = signEvent(buildEvent("paystack", "charge.success"), "sk_test_1");
    await expect(deliver(signed, server.url, { timeoutMs: 50 })).rejects.toThrow(/No response/);
  });
});
