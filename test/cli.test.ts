import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { paystackSignature } from "../src/providers/paystack.js";
import { startServer, type TestServer } from "./helpers/server.js";

const exec = promisify(execFile);
const cli = resolve(__dirname, "../dist/cli.js");

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function paylocal(
  args: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Promise<Run> {
  const env = {
    ...process.env,
    NO_COLOR: "1",
    PAYSTACK_SECRET_KEY: "",
    FLUTTERWAVE_SECRET_HASH: "",
    PAYLOCAL_URL: "",
    ...opts.env,
  };
  try {
    const { stdout, stderr } = await exec(process.execPath, [cli, ...args], { cwd: opts.cwd, env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

let cwd: string;
let server: TestServer | undefined;

beforeAll(() => {
  if (!existsSync(cli)) {
    throw new Error(`${cli} is missing. Run "pnpm build" before "pnpm test".`);
  }
});

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "paylocal-cli-"));
});

afterEach(async () => {
  await server?.close();
  server = undefined;
  await rm(cwd, { recursive: true, force: true });
});

describe("paylocal cli", () => {
  it("prints the version and help", async () => {
    const v = await paylocal(["--version"]);
    expect(v.code).toBe(0);
    expect(v.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);

    const h = await paylocal(["--help"]);
    expect(h.code).toBe(0);
    expect(h.stdout).toContain("paylocal trigger <provider> <event>");

    const none = await paylocal([]);
    expect(none.code).toBe(0);
    expect(none.stdout).toContain("Usage");
  });

  it("lists events as JSON", async () => {
    const r = await paylocal(["events", "paystack", "--json"]);
    expect(r.code).toBe(0);
    const events = JSON.parse(r.stdout) as Array<{ provider: string; event: string }>;
    expect(events.every((e) => e.provider === "paystack")).toBe(true);
    expect(events.map((e) => e.event)).toContain("charge.success");
  });

  it("fails with exit 2 and a hint when the endpoint or secret is missing", async () => {
    const noSecret = await paylocal([
      "trigger",
      "paystack",
      "charge.success",
      "--to",
      "http://localhost:1",
    ]);
    expect(noSecret.code).toBe(2);
    expect(noSecret.stderr).toContain("PAYSTACK_SECRET_KEY");

    const noUrl = await paylocal(["trigger", "paystack", "charge.success", "--secret", "x"]);
    expect(noUrl.code).toBe(2);
    expect(noUrl.stderr).toContain("--to");
  });

  it("rejects unknown commands, providers, events and flags", async () => {
    expect((await paylocal(["explode"])).code).toBe(2);
    expect((await paylocal(["events", "stripe"])).code).toBe(2);
    expect(
      (
        await paylocal([
          "trigger",
          "paystack",
          "nope",
          "--to",
          "http://x",
          "--secret",
          "s",
          "--dry-run",
        ])
      ).code,
    ).toBe(2);
    expect((await paylocal(["events", "--bogus"])).code).toBe(2);
  });

  it("dry-run prints the signed request without sending", async () => {
    const r = await paylocal([
      "trigger",
      "paystack",
      "charge.success",
      "--to",
      "http://127.0.0.1:1/never",
      "--secret",
      "sk_test_dry",
      "--amount",
      "999",
      "--set",
      "data.metadata.order=42",
      "--dry-run",
      "--json",
    ]);
    expect(r.code).toBe(0);
    const out = JSON.parse(r.stdout) as {
      url: string;
      headers: Record<string, string>;
      payload: { data: Record<string, unknown> };
    };
    expect(out.url).toBe("http://127.0.0.1:1/never");
    expect(out.payload.data.amount).toBe(999);
    expect(out.payload.data.metadata).toEqual({ order: 42 });
    expect(out.headers["x-paystack-signature"]).toBe(
      paystackSignature(JSON.stringify(out.payload), "sk_test_dry"),
    );
  });

  it("triggers, logs, lists and replays an event end to end", async () => {
    server = await startServer((req) =>
      req.headers["x-paystack-signature"] === paystackSignature(req.body, "sk_test_e2e")
        ? { status: 200 }
        : { status: 401 },
    );
    const url = `${server.url}/webhooks/paystack`;

    const trigger = await paylocal(
      ["trigger", "paystack", "transfer.success", "--to", url, "--json"],
      { cwd, env: { PAYSTACK_SECRET_KEY: "sk_test_e2e" } },
    );
    expect(trigger.code).toBe(0);
    const sent = JSON.parse(trigger.stdout) as { status: number; logId: string };
    expect(sent.status).toBe(200);
    expect(sent.logId).toMatch(/paystack-transfer\.success$/);
    expect(await readdir(join(cwd, ".paylocal/events"))).toHaveLength(1);

    const log = await paylocal(["log", "--json"], { cwd });
    expect(JSON.parse(log.stdout)).toHaveLength(1);

    const replay = await paylocal(
      ["replay", sent.logId, "--to", url, "--secret", "sk_test_e2e", "--json"],
      { cwd },
    );
    expect(replay.code).toBe(0);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0]!.body).toBe(server.requests[1]!.body);
  });

  it("returns exit 1 when the endpoint rejects the event", async () => {
    server = await startServer(() => ({ status: 400 }));
    const r = await paylocal(
      [
        "trigger",
        "flutterwave",
        "charge.completed",
        "--to",
        server.url,
        "--secret",
        "h",
        "--no-log",
      ],
      { cwd },
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain("✖ 400");
    expect(existsSync(join(cwd, ".paylocal"))).toBe(false);
  });

  it("verify exits 0 only for endpoints that check signatures", async () => {
    server = await startServer(() => ({ status: 200 }));
    const naive = await paylocal(["verify", "paystack", "--to", server.url, "--secret", "s"], {
      cwd,
    });
    expect(naive.code).toBe(1);
    expect(naive.stdout).toContain("not verified");
    await server.close();

    server = await startServer((req) =>
      req.headers["x-paystack-signature"] === paystackSignature(req.body, "s")
        ? { status: 200 }
        : { status: 403 },
    );
    const strict = await paylocal(["verify", "paystack", "--to", server.url, "--secret", "s"], {
      cwd,
    });
    expect(strict.code).toBe(0);
    expect(strict.stdout).toContain("✔ verified");
  });
});
