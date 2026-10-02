import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildEvent, webhook } from "../src/core/build.js";
import { buildScenario, listScenarios, scenario } from "../src/core/scenario.js";
import { listEvents } from "../src/providers/index.js";
import { paystackSignature } from "../src/providers/paystack.js";
import { getPath } from "../src/util/path.js";
import { startServer, type TestServer } from "./helpers/server.js";

const exec = promisify(execFile);
const cli = resolve(__dirname, "../dist/cli.js");
const secret = "sk_test_v02";

let cwd: string;
let server: TestServer | undefined;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "paylocal-v02-"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(cwd, { recursive: true, force: true });
});

async function paylocal(args: string[]) {
  const env = { ...process.env, NO_COLOR: "1", PAYSTACK_SECRET_KEY: "", PAYLOCAL_URL: "" };
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, ...args], { cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("shortcuts land where each event keeps the field", () => {
  it("puts a refund's reference in transaction_reference", () => {
    for (const event of [
      "refund.pending",
      "refund.processing",
      "refund.processed",
      "refund.failed",
    ]) {
      const { payload } = buildEvent("paystack", event, { reference: "ORD-1", amount: 700 });
      expect(getPath(payload, "data.transaction_reference")).toBe("ORD-1");
      expect(getPath(payload, "data.reference")).toBeUndefined();
      expect(getPath(payload, "data.amount")).toBe(700);
    }
  });

  it("puts a dispute's reference and amount on its transaction", () => {
    const { payload } = buildEvent("paystack", "charge.dispute.create", {
      reference: "ORD-2",
      amount: 480_000,
      currency: "GHS",
    });
    expect(getPath(payload, "data.transaction.reference")).toBe("ORD-2");
    expect(getPath(payload, "data.transaction.amount")).toBe(480_000);
    expect(getPath(payload, "data.refund_amount")).toBe(480_000);
    expect(getPath(payload, "data.transaction.currency")).toBe("GHS");
    expect(getPath(payload, "data.reference")).toBeUndefined();
    expect(getPath(payload, "data.amount")).toBeUndefined();
  });

  it("keeps the amounts that always agree in step", () => {
    const charge = buildEvent("paystack", "charge.success", { amount: 42 });
    expect(getPath(charge.payload, "data.requested_amount")).toBe(42);
    const invoice = buildEvent("paystack", "invoice.update", { amount: 42, reference: "INV-9" });
    expect(getPath(invoice.payload, "data.transaction.amount")).toBe(42);
    expect(getPath(invoice.payload, "data.transaction.reference")).toBe("INV-9");
    const flw = buildEvent("flutterwave", "charge.completed", { amount: 42 });
    expect(getPath(flw.payload, "data.charged_amount")).toBe(42);
  });

  it("puts a Flutterwave refund's amount in amount_refunded and a transfer's reference in reference", () => {
    const refund = buildEvent("flutterwave", "refund.completed", { amount: 300, reference: "T-1" });
    expect(getPath(refund.payload, "data.amount_refunded")).toBe(300);
    expect(getPath(refund.payload, "data.amount")).toBeUndefined();
    expect(getPath(refund.payload, "data.tx_ref")).toBe("T-1");
    const transfer = buildEvent("flutterwave", "transfer.completed", { reference: "PAYOUT-1" });
    expect(getPath(transfer.payload, "data.reference")).toBe("PAYOUT-1");
    expect(getPath(transfer.payload, "data.tx_ref")).toBeUndefined();
  });

  it("refuses a shortcut for a field the event does not have", () => {
    expect(() => buildEvent("paystack", "subscription.create", { reference: "X" })).toThrow(
      /Paystack subscription.create has no reference field/,
    );
    expect(() => buildEvent("paystack", "transfer.success", { email: "a@b.c" })).toThrow(
      /no email field/,
    );
    expect(() => buildEvent("flutterwave", "refund.completed", { currency: "NGN" })).toThrow(
      /no currency field/,
    );
  });

  it("never invents a field: every shortcut an event accepts overwrites one the template has", () => {
    const names = ["amount", "email", "reference", "currency"] as const;
    for (const { provider, event } of listEvents()) {
      const plain = buildEvent(provider, event.name).payload;
      for (const name of names) {
        const value = name === "amount" ? 123 : "value";
        let built;
        try {
          built = buildEvent(provider, event.name, { [name]: value }).payload;
        } catch {
          continue; // the event says it has no such field
        }
        const added = leaves(built).filter((path) => !leaves(plain).includes(path));
        expect(added, `${provider} ${event.name} --${name}`).toEqual([]);
      }
    }
  });
});

function leaves(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [prefix];
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return [prefix];
  return entries.flatMap(([key, child]) => leaves(child, prefix ? `${prefix}.${key}` : key));
}

describe("fixtures for requests that must be refused", () => {
  it("tamper() keeps the signature and changes the body for Paystack", () => {
    const fixture = webhook("paystack", "charge.success");
    const signed = fixture.sign(secret);
    const forged = fixture.tamper(secret);
    expect(forged.headers["x-paystack-signature"]).toBe(signed.headers["x-paystack-signature"]);
    expect(forged.body).not.toBe(signed.body);
    expect(paystackSignature(forged.body, secret)).not.toBe(forged.headers["x-paystack-signature"]);
    expect(forged.description).toMatch(/body changed/);
  });

  it("tamper() changes the hash for Flutterwave, which does not sign the body", () => {
    const forged = webhook("flutterwave", "charge.completed").tamper("hash");
    expect(forged.headers["verif-hash"]).not.toBe("hash");
  });

  it("unsigned() has the body and no signature header", () => {
    const fixture = webhook("paystack", "charge.success");
    const bare = fixture.unsigned();
    expect(bare.body).toBe(fixture.body);
    expect(bare.headers).toEqual({ "content-type": "application/json" });
  });

  it("send() signs and delivers", async () => {
    server = await startServer(() => ({ status: 200 }));
    const fixture = webhook("paystack", "charge.success");
    const result = await fixture.send(server.url, secret);
    expect(result.status).toBe(200);
    const [request] = server.requests;
    expect(request!.body).toBe(fixture.body);
    expect(request!.headers["x-paystack-signature"]).toBe(paystackSignature(fixture.body, secret));
  });
});

describe("scenarios", () => {
  it("builds a Paystack refund whose notices share one transaction and one refund", () => {
    const events = buildScenario("paystack", "refund", {
      reference: "ORD-1042",
      amount: 1_250_000,
      email: "bisi@example.com",
    });
    expect(events.map((e) => e.event)).toEqual([
      "charge.success",
      "refund.pending",
      "refund.processing",
      "refund.processed",
    ]);
    const [charge, ...refunds] = events.map((e) => e.payload);
    expect(getPath(charge!, "data.reference")).toBe("ORD-1042");
    const refundReferences = new Set<unknown>();
    for (const refund of refunds) {
      expect(getPath(refund, "data.transaction_reference")).toBe("ORD-1042");
      expect(getPath(refund, "data.amount")).toBe(1_250_000);
      expect(getPath(refund, "data.customer.email")).toBe("bisi@example.com");
      refundReferences.add(getPath(refund, "data.refund_reference"));
    }
    expect(refundReferences.size).toBe(1);
  });

  it("builds a dispute against the charge's own transaction id", () => {
    const [charge, dispute] = buildScenario("paystack", "dispute", { reference: "ORD-7" });
    expect(getPath(dispute!.payload, "data.transaction.id")).toBe(
      getPath(charge!.payload, "data.id"),
    );
    expect(getPath(dispute!.payload, "data.transaction.reference")).toBe("ORD-7");
    expect(getPath(dispute!.payload, "data.refund_amount")).toBe(
      getPath(charge!.payload, "data.amount"),
    );
  });

  it("carries a field set on the first notice through to the rest", () => {
    const [charge, refund] = buildScenario("flutterwave", "refund", {
      reference: "ORD-3",
      amount: 30_000,
      set: { "data.id": 7001 },
    });
    expect(getPath(charge!.payload, "data.id")).toBe(7001);
    expect(getPath(refund!.payload, "data.tx_id")).toBe(7001);
    expect(getPath(refund!.payload, "data.tx_ref")).toBe("ORD-3");
    expect(getPath(refund!.payload, "data.amount_refunded")).toBe(30_000);
  });

  it("has a failed Flutterwave payment", () => {
    const [failed] = buildScenario("flutterwave", "failed-payment", { reference: "ORD-4" });
    expect(getPath(failed!.payload, "data.status")).toBe("failed");
    expect(getPath(failed!.payload, "data.tx_ref")).toBe("ORD-4");
  });

  it("returns fixtures a test can send in any order", async () => {
    server = await startServer(() => ({ status: 200 }));
    const [charge, , , processed] = scenario("paystack", "refund", { reference: "ORD-5" });
    await processed!.send(server.url, secret);
    await charge!.send(server.url, secret);
    expect(server.requests.map((r) => (JSON.parse(r.body) as { event: string }).event)).toEqual([
      "refund.processed",
      "charge.success",
    ]);
  });

  it("only names events the provider has, and rejects unknown scenarios", () => {
    for (const { provider, scenario: definition } of listScenarios()) {
      expect(() => buildScenario(provider, definition.name)).not.toThrow();
    }
    expect(() => buildScenario("paystack", "nope")).toThrow(/Unknown Paystack scenario/);
  });
});

describe("cli", () => {
  const events = () => server!.requests.map((r) => (JSON.parse(r.body) as { event: string }).event);

  it("scenario sends every notice in order, and --reverse and --twice change that", async () => {
    server = await startServer(() => ({ status: 200 }));
    const base = ["scenario", "paystack", "refund", "--to", server.url, "--secret", secret];

    const forward = await paylocal([...base, "--reference", "ORD-9"]);
    expect(forward.code).toBe(0);
    expect(events()).toEqual([
      "charge.success",
      "refund.pending",
      "refund.processing",
      "refund.processed",
    ]);
    expect(server.requests.every((r) => r.body.includes("ORD-9"))).toBe(true);

    server.requests.length = 0;
    await paylocal([...base, "--reverse"]);
    expect(events()[0]).toBe("refund.processed");
    expect(events()[3]).toBe("charge.success");

    server.requests.length = 0;
    await paylocal([
      "scenario",
      "paystack",
      "payment",
      "--to",
      server.url,
      "--secret",
      secret,
      "--twice",
    ]);
    expect(events()).toEqual(["charge.success", "charge.success"]);
    expect(server.requests[0]!.body).toBe(server.requests[1]!.body);
  });

  it("scenario exits 1 when any notice is rejected, and prints one JSON array", async () => {
    let seen = 0;
    server = await startServer(() => ({ status: ++seen === 2 ? 500 : 200 }));
    const r = await paylocal([
      "scenario",
      "paystack",
      "dispute",
      "--to",
      server.url,
      "--secret",
      secret,
      "--json",
    ]);
    expect(r.code).toBe(1);
    const reports = JSON.parse(r.stdout) as Array<{ event: string; status: number }>;
    expect(reports.map((x) => [x.event, x.status])).toEqual([
      ["charge.success", 200],
      ["charge.dispute.create", 500],
    ]);
  });

  it("scenarios lists them", async () => {
    const r = await paylocal(["scenarios", "flutterwave", "--json"]);
    const list = JSON.parse(r.stdout) as Array<{ scenario: string; events: string[] }>;
    expect(list.map((s) => s.scenario)).toEqual(["payment", "failed-payment", "refund"]);
    expect(list[2]!.events).toEqual(["charge.completed", "refund.completed"]);
  });

  it("replay last sends the newest delivery again, byte for byte", async () => {
    server = await startServer(() => ({ status: 200 }));
    await paylocal([
      "trigger",
      "paystack",
      "charge.success",
      "--to",
      server.url,
      "--secret",
      secret,
    ]);
    const again = await paylocal(["replay", "last", "--to", server.url, "--secret", secret]);
    expect(again.code).toBe(0);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]!.body).toBe(server.requests[0]!.body);
    expect(server.requests[1]!.headers["x-paystack-signature"]).toBe(
      server.requests[0]!.headers["x-paystack-signature"],
    );
  });

  it("replay last says so when the log is empty", async () => {
    const r = await paylocal(["replay", "last", "--to", "http://127.0.0.1:1", "--secret", secret]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Nothing to replay yet");
  });

  it("refuses a shortcut the event has no field for", async () => {
    const r = await paylocal([
      "trigger",
      "paystack",
      "subscription.create",
      "--to",
      "http://127.0.0.1:1",
      "--secret",
      secret,
      "--reference",
      "X",
      "--dry-run",
    ]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("has no reference field");
  });

  it("verify prints a line for each forged request", async () => {
    server = await startServer((req) =>
      req.headers["x-paystack-signature"] === paystackSignature(req.body, secret)
        ? { status: 200 }
        : { status: 401 },
    );
    const r = await paylocal(["verify", "paystack", "--to", server.url, "--secret", secret]);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/no signature\s+rejected HTTP 401/);
    expect(r.stdout).toMatch(/wrong secret\s+rejected HTTP 401/);
    expect(r.stdout).toMatch(/changed body\s+rejected HTTP 401/);
    expect(r.stdout).toContain("3 forged requests refused");
  });
});
