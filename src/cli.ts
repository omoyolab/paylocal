#!/usr/bin/env node
import { parseArgs } from "node:util";

import { buildEvent, fromPayload, signEvent } from "./core/build.js";
import { listDeliveries, readReplaySource, recordDelivery } from "./core/log.js";
import { buildScenario, listScenarios } from "./core/scenario.js";
import { deliver } from "./core/send.js";
import { verifyEndpoint } from "./core/verify.js";
import { PaylocalError } from "./errors.js";
import { getProvider, listEvents, providerIds } from "./providers/index.js";
import type { LogEntry, Provider, SendResult, SignedEvent, VerifyResult } from "./types.js";
import { parseAssignment } from "./util/path.js";
import { createPainter, shouldUseColor, table, truncate, type Painter } from "./util/term.js";
import { version } from "./version.js";

const HELP = `paylocal ${version} - local webhook tooling for Paystack and Flutterwave

Usage
  paylocal trigger <provider> <event> --to <url> [options]
  paylocal scenario <provider> <name> --to <url> [options]
  paylocal replay <last|id|file> --to <url> [options]
  paylocal verify <provider> --to <url> [options]
  paylocal events [provider]
  paylocal scenarios [provider]
  paylocal log [--limit <n>]

Providers
  ${providerIds.join(", ")}

Options
  --to <url>              Endpoint that receives the webhook (or PAYLOCAL_URL)
  --secret <value>        Signing secret (or PAYSTACK_SECRET_KEY / FLUTTERWAVE_SECRET_HASH)
  --set <path=value>      Override any payload field, repeatable
                          e.g. --set data.amount=250000 --set data.customer.email=ada@example.com
                          In a scenario it applies to the first notice, and the rest follow it
  --header <Name: value>  Add a request header, repeatable
  --amount <n>            Shortcut for the amount field, in the provider's own unit:
                          kobo for Paystack, naira for Flutterwave
  --email <address>       Shortcut for the customer email field
  --reference <ref>       Shortcut for the transaction reference field, wherever the
                          event keeps it
  --currency <code>       Shortcut for the currency field
  --reverse               scenario: send the notices last to first
  --twice                 scenario: send every notice two times
  --event <name>          Event used by verify (defaults per provider)
  --provider <id>         Provider for replay when it cannot be inferred
  --dry-run               Print the signed request instead of sending it
  --no-log                Do not record the delivery in .paylocal/events
  --timeout <ms>          Request timeout, default 10000
  --limit <n>             Number of log entries to show, default 20
  --json                  Machine-readable output
  -h, --help              Show this help
  -v, --version           Show the version

Examples
  paylocal trigger paystack charge.success --to http://localhost:3000/webhooks/paystack
  paylocal trigger flutterwave charge.completed --to http://localhost:3000/hooks --amount 12000
  paylocal verify paystack --to http://localhost:3000/webhooks/paystack
  paylocal scenario paystack refund --to http://localhost:3000/webhooks/paystack --reference ORD-1042
  paylocal replay last --to http://localhost:3000/webhooks/paystack

Exit codes
  0  success            1  delivery rejected or endpoint not verified            2  usage error
`;

interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  paint: Painter;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      to: { type: "string" },
      secret: { type: "string" },
      set: { type: "string", multiple: true },
      header: { type: "string", multiple: true },
      amount: { type: "string" },
      email: { type: "string" },
      reference: { type: "string" },
      currency: { type: "string" },
      event: { type: "string" },
      provider: { type: "string" },
      reverse: { type: "boolean" },
      twice: { type: "boolean" },
      "dry-run": { type: "boolean" },
      "no-log": { type: "boolean" },
      timeout: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

type Values = ReturnType<typeof parse>["values"];

function requireUrl(values: Values, io: Io): string {
  const url = values.to ?? io.env.PAYLOCAL_URL;
  if (!url) {
    throw new PaylocalError(
      "No endpoint given",
      "Pass --to http://localhost:3000/webhooks or set PAYLOCAL_URL",
    );
  }
  return url;
}

function requireSecret(provider: Provider, values: Values, io: Io): string {
  const secret = values.secret ?? io.env[provider.secretEnv];
  if (!secret) {
    throw new PaylocalError(
      `No ${provider.name} secret given`,
      `Pass --secret or set ${provider.secretEnv} to your ${provider.secretLabel}`,
    );
  }
  return secret;
}

function parseNumber(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new PaylocalError(`--${name} must be a non-negative number, got "${raw}"`);
  }
  return n;
}

function parseHeaders(values: Values): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const raw of values.header ?? []) {
    const colon = raw.indexOf(":");
    const name = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();
    if (colon < 1 || !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new PaylocalError(`Invalid --header "${raw}"`, 'Use --header "Name: value"');
    }
    headers[name] = value;
  }
  // Provider signatures are generated by paylocal, including deliberate verification forgeries.
  for (const id of providerIds) delete headers[getProvider(id).signatureHeader];
  return headers;
}

function buildOptions(values: Values) {
  const set: Record<string, unknown> = {};
  for (const assignment of values.set ?? []) {
    const [path, value] = parseAssignment(assignment);
    set[path] = value;
  }
  const amount = values.amount === undefined ? undefined : parseNumber(values.amount, "amount", 0);
  return {
    set,
    amount,
    email: values.email,
    reference: values.reference,
    currency: values.currency,
  };
}

function printRequest(signed: SignedEvent, url: string, io: Io): void {
  const { paint } = io;
  io.out(
    `${paint.bold("paylocal")} ${paint.dim("▸")} ${signed.provider} ${paint.cyan(signed.event)} ${paint.dim("→")} ${url}`,
  );
  io.out("");
  const provider = getProvider(signed.provider);
  const rows = provider.summarize(signed.payload);
  for (const [header, value] of Object.entries(signed.headers)) {
    rows.push([header, value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value]);
  }
  if (rows.length > 0) io.out(table(rows));
}

function printResult(result: SendResult, io: Io): void {
  const { paint } = io;
  const status = result.ok ? paint.green(`✔ ${result.status}`) : paint.red(`✖ ${result.status}`);
  io.out("");
  io.out(`${status} ${paint.dim(`in ${result.durationMs}ms`)}`);
  if (result.responseBody.trim().length > 0) {
    io.out(`  ${paint.dim(truncate(result.responseBody, 160))}`);
  }
}

/**
 * Sends one signed event and reports on it. When `collect` is given, the JSON report
 * is added to it instead of printed, so a scenario can print one array at the end.
 */
async function send(
  signed: SignedEvent,
  values: Values,
  io: Io,
  collect?: unknown[],
): Promise<number> {
  const url = requireUrl(values, io);
  const timeoutMs = parseNumber(values.timeout, "timeout", 10_000);
  const headers = { ...parseHeaders(values), ...signed.headers };
  const json = (report: unknown) => {
    if (collect) collect.push(report);
    else io.out(JSON.stringify(report, null, 2));
  };

  if (values["dry-run"]) {
    if (values.json) {
      json({ url, headers, payload: signed.payload });
    } else {
      printRequest({ ...signed, headers }, url, io);
      io.out("");
      io.out(io.paint.dim("dry run, nothing sent. Payload:"));
      io.out(JSON.stringify(signed.payload, null, 2));
    }
    return 0;
  }

  const result = await deliver({ body: signed.body, headers: signed.headers }, url, {
    timeoutMs,
    headers,
  });
  let entry: LogEntry | undefined;
  if (!values["no-log"]) {
    entry = await recordDelivery(signed, result, io.cwd);
  }

  if (values.json) {
    json({ ...result, provider: signed.provider, event: signed.event, logId: entry?.id ?? null });
  } else {
    printRequest({ ...signed, headers }, url, io);
    printResult(result, io);
    if (entry) io.out(`  ${io.paint.dim(`logged as ${entry.id}`)}`);
  }
  return result.ok ? 0 : 1;
}

async function commandTrigger(positionals: string[], values: Values, io: Io): Promise<number> {
  const [providerId, eventName] = positionals;
  if (!providerId || !eventName) {
    throw new PaylocalError(
      "trigger needs a provider and an event",
      "Example: paylocal trigger paystack charge.success --to http://localhost:3000/webhooks",
    );
  }
  const provider = getProvider(providerId);
  const secret = requireSecret(provider, values, io);
  const signed = signEvent(buildEvent(provider.id, eventName, buildOptions(values)), secret);
  return send(signed, values, io);
}

async function commandScenario(positionals: string[], values: Values, io: Io): Promise<number> {
  const [providerId, name] = positionals;
  if (!providerId || !name) {
    throw new PaylocalError(
      "scenario needs a provider and a scenario name",
      "Example: paylocal scenario paystack refund --to http://localhost:3000/webhooks",
    );
  }
  const provider = getProvider(providerId);
  const secret = requireSecret(provider, values, io);
  let events = buildScenario(provider.id, name, buildOptions(values));
  if (values.reverse) events = [...events].reverse();
  if (values.twice) events = events.flatMap((event) => [event, event]);

  const reports: unknown[] = [];
  let code = 0;
  for (const [index, built] of events.entries()) {
    if (index > 0 && !values.json) io.out("");
    const outcome = await send(signEvent(built, secret), values, io, reports);
    if (outcome !== 0) code = outcome;
  }
  if (values.json) io.out(JSON.stringify(reports, null, 2));
  return code;
}

async function commandReplay(positionals: string[], values: Values, io: Io): Promise<number> {
  const [source] = positionals;
  if (!source) {
    throw new PaylocalError(
      'replay needs "last", a log id or a path to a JSON payload',
      'Run "paylocal log" to see ids',
    );
  }
  const stored = await readReplaySource(source, io.cwd);
  const providerId = values.provider ?? stored.provider;
  if (!providerId) {
    throw new PaylocalError(
      `Cannot tell which provider ${stored.origin} belongs to`,
      "Pass --provider paystack or --provider flutterwave",
    );
  }
  const provider = getProvider(providerId);
  const secret = requireSecret(provider, values, io);
  const signed = signEvent(fromPayload(provider.id, stored.payload), secret);
  return send(signed, values, io);
}

function printVerify(result: VerifyResult, io: Io): void {
  const { paint } = io;
  const badge = {
    verified: paint.green("✔ verified"),
    "not-verified": paint.red("✖ not verified"),
    inconclusive: paint.yellow("? inconclusive"),
  }[result.verdict];
  io.out(
    `${paint.bold("paylocal")} ${paint.dim("▸")} verify ${result.provider} ${paint.dim("→")} ${result.url}`,
  );
  io.out("");
  io.out(
    table([
      [
        "valid event",
        `${result.valid.ok ? paint.green("accepted") : paint.red("rejected")} ${paint.dim(`HTTP ${result.valid.status}, ${result.valid.durationMs}ms`)}`,
      ],
      ...result.probes.map((probe): [string, string] => {
        const word = {
          rejected: paint.green("rejected"),
          accepted: paint.red("accepted"),
          crashed: paint.red("crashed "),
        }[probe.outcome];
        return [
          probe.name.replace(/-/g, " "),
          `${word} ${paint.dim(`HTTP ${probe.result.status}, ${probe.result.durationMs}ms`)}`,
        ];
      }),
    ]),
  );
  io.out("");
  io.out(badge);
  for (const note of result.notes) io.out(`  ${note}`);
}

async function commandVerify(positionals: string[], values: Values, io: Io): Promise<number> {
  const [providerId] = positionals;
  if (!providerId) {
    throw new PaylocalError(
      "verify needs a provider",
      "Example: paylocal verify paystack --to http://localhost:3000/webhooks",
    );
  }
  const provider = getProvider(providerId);
  const url = requireUrl(values, io);
  const secret = requireSecret(provider, values, io);
  const timeoutMs = parseNumber(values.timeout, "timeout", 10_000);
  const result = await verifyEndpoint(provider.id, url, secret, {
    event: values.event,
    timeoutMs,
    headers: parseHeaders(values),
  });
  if (values.json) {
    io.out(JSON.stringify(result, null, 2));
  } else {
    printVerify(result, io);
  }
  return result.verdict === "verified" ? 0 : 1;
}

function commandEvents(positionals: string[], values: Values, io: Io): number {
  const entries = listEvents(positionals[0]);
  if (values.json) {
    io.out(
      JSON.stringify(
        entries.map(({ provider, event }) => ({
          provider,
          event: event.name,
          description: event.description,
        })),
        null,
        2,
      ),
    );
    return 0;
  }
  let current: string | undefined;
  for (const { provider, event } of entries) {
    if (provider !== current) {
      if (current) io.out("");
      const p = getProvider(provider);
      io.out(`${io.paint.bold(p.name)} ${io.paint.dim(`(${p.signatureHeader}, ${p.secretEnv})`)}`);
      current = provider;
    }
    io.out(`  ${io.paint.cyan(event.name.padEnd(34))} ${io.paint.dim(event.description)}`);
  }
  return 0;
}

function commandScenarios(positionals: string[], values: Values, io: Io): number {
  const entries = listScenarios(positionals[0]);
  if (values.json) {
    io.out(
      JSON.stringify(
        entries.map(({ provider, scenario }) => ({
          provider,
          scenario: scenario.name,
          description: scenario.description,
          events: scenario.steps.map((step) => step.event),
        })),
        null,
        2,
      ),
    );
    return 0;
  }
  let current: string | undefined;
  for (const { provider, scenario } of entries) {
    if (provider !== current) {
      if (current) io.out("");
      io.out(io.paint.bold(getProvider(provider).name));
      current = provider;
    }
    io.out(`  ${io.paint.cyan(scenario.name.padEnd(16))} ${scenario.description}`);
    io.out(
      `  ${"".padEnd(16)} ${io.paint.dim(scenario.steps.map((step) => step.event).join(", "))}`,
    );
  }
  return 0;
}

async function commandLog(values: Values, io: Io): Promise<number> {
  const limit = parseNumber(values.limit, "limit", 20);
  const entries = await listDeliveries(io.cwd, limit);
  if (values.json) {
    io.out(
      JSON.stringify(
        entries.map(({ payload: _payload, ...rest }) => rest),
        null,
        2,
      ),
    );
    return 0;
  }
  if (entries.length === 0) {
    io.out(io.paint.dim("No deliveries recorded yet. Run a trigger first."));
    return 0;
  }
  for (const entry of entries) {
    const status = entry.ok
      ? io.paint.green(String(entry.status))
      : io.paint.red(String(entry.status));
    io.out(`${status}  ${entry.id}  ${io.paint.dim(entry.url)}`);
  }
  return 0;
}

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.err(`paylocal: ${error instanceof Error ? error.message : String(error)}`);
    io.err('Run "paylocal --help" for usage.');
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    io.out(version);
    return 0;
  }
  const [command = "help", ...rest] = positionals;
  if (values.help || command === "help") {
    io.out(HELP);
    return 0;
  }

  try {
    switch (command) {
      case "trigger":
        return await commandTrigger(rest, values, io);
      case "scenario":
        return await commandScenario(rest, values, io);
      case "scenarios":
        return commandScenarios(rest, values, io);
      case "replay":
        return await commandReplay(rest, values, io);
      case "verify":
        return await commandVerify(rest, values, io);
      case "events":
        return commandEvents(rest, values, io);
      case "log":
        return await commandLog(values, io);
      default:
        throw new PaylocalError(`Unknown command "${command}"`, 'Run "paylocal --help" for usage.');
    }
  } catch (error) {
    if (error instanceof PaylocalError) {
      io.err(`${io.paint.red("paylocal:")} ${error.message}`);
      if (error.hint) io.err(`  ${io.paint.dim(error.hint)}`);
      return 2;
    }
    throw error;
  }
}

const io: Io = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
  cwd: process.cwd(),
  paint: createPainter(shouldUseColor()),
};

run(process.argv.slice(2), io).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `paylocal: unexpected error\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 2;
  },
);
