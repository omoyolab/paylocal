import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildEvent, signEvent } from "../src/core/build.js";
import { LOG_DIR, listDeliveries, readReplaySource, recordDelivery } from "../src/core/log.js";
import { PaylocalError } from "../src/errors.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "paylocal-log-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

const result = {
  url: "http://localhost:3000/hooks",
  status: 200,
  ok: true,
  durationMs: 12,
  responseBody: "",
};

describe("delivery log", () => {
  it("records a delivery and lists it newest first", async () => {
    const first = signEvent(buildEvent("paystack", "charge.success"), "s");
    const second = signEvent(buildEvent("flutterwave", "charge.completed"), "s");
    const a = await recordDelivery(first, result, cwd, new Date("2026-01-01T10:00:00.000Z"));
    const b = await recordDelivery(second, result, cwd, new Date("2026-01-01T10:00:01.000Z"));

    expect(a.id).toBe("20260101-100000-000-paystack-charge.success");
    expect(b.id).toMatch(/flutterwave-charge\.completed$/);
    expect(await readdir(join(cwd, LOG_DIR))).toHaveLength(2);

    const entries = await listDeliveries(cwd);
    expect(entries.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(entries[0]!.payload).toEqual(second.payload);
  });

  it("returns an empty list when nothing was recorded", async () => {
    expect(await listDeliveries(cwd)).toEqual([]);
  });

  it("honors the limit", async () => {
    const signed = signEvent(buildEvent("paystack", "charge.success"), "s");
    for (let i = 0; i < 5; i++) {
      await recordDelivery(signed, result, cwd, new Date(2026, 0, 1, 0, 0, i));
    }
    expect(await listDeliveries(cwd, 2)).toHaveLength(2);
  });
});

describe("readReplaySource", () => {
  it("resolves a log id and remembers its provider", async () => {
    const signed = signEvent(buildEvent("paystack", "refund.processed"), "s");
    const entry = await recordDelivery(signed, result, cwd);
    const stored = await readReplaySource(entry.id, cwd);
    expect(stored.provider).toBe("paystack");
    expect(stored.payload).toEqual(signed.payload);
  });

  it("resolves a raw payload file without a provider", async () => {
    const payload = { event: "charge.completed", data: { amount: 1 } };
    await writeFile(join(cwd, "captured.json"), JSON.stringify(payload));
    const stored = await readReplaySource("captured.json", cwd);
    expect(stored.provider).toBeUndefined();
    expect(stored.payload).toEqual(payload);
  });

  it("rejects invalid JSON and missing files with hints", async () => {
    await writeFile(join(cwd, "broken.json"), "{oops");
    await expect(readReplaySource("broken.json", cwd)).rejects.toThrow(/not valid JSON/);
    await expect(readReplaySource("missing", cwd)).rejects.toThrow(PaylocalError);
  });
});
