import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { PaylocalError } from "../errors.js";
import type { LogEntry, ProviderId, SendResult, SignedEvent } from "../types.js";

export const LOG_DIR = ".paylocal/events";

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Ids are UTC so a log copied between machines still sorts chronologically. */
function makeId(now: Date, provider: ProviderId, event: string): string {
  const stamp =
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-` +
    `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}-${pad(now.getUTCMilliseconds(), 3)}`;
  const safeEvent = event.replace(/[^A-Za-z0-9._-]/g, "_");
  return `${stamp}-${provider}-${safeEvent}`;
}

export function logDir(cwd = process.cwd()): string {
  return resolve(cwd, LOG_DIR);
}

/** Writes a delivery record to `.paylocal/events/<id>.json` and returns it. */
export async function recordDelivery(
  signed: SignedEvent,
  result: SendResult,
  cwd = process.cwd(),
  now = new Date(),
): Promise<LogEntry> {
  const entry: LogEntry = {
    id: makeId(now, signed.provider, signed.event),
    at: now.toISOString(),
    provider: signed.provider,
    event: signed.event,
    url: result.url,
    status: result.status,
    ok: result.ok,
    durationMs: result.durationMs,
    payload: signed.payload,
  };
  const dir = logDir(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${entry.id}.json`), `${JSON.stringify(entry, null, 2)}\n`, "utf8");
  return entry;
}

/** Lists recorded deliveries, newest first. */
export async function listDeliveries(cwd = process.cwd(), limit = 20): Promise<LogEntry[]> {
  let names: string[];
  try {
    names = await readdir(logDir(cwd));
  } catch {
    return [];
  }
  const ids = names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);
  const entries: LogEntry[] = [];
  for (const name of ids) {
    const entry = await readEntryFile(join(logDir(cwd), name));
    if (entry) entries.push(entry);
  }
  return entries;
}

async function readEntryFile(path: string): Promise<LogEntry | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (isLogEntry(parsed)) return parsed;
    return null;
  } catch {
    return null;
  }
}

function isLogEntry(value: unknown): value is LogEntry {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.provider === "string" &&
    typeof v.event === "string" &&
    typeof v.payload === "object" &&
    v.payload !== null
  );
}

/**
 * Resolves a replay source. Accepts a log id, a path to a log file, or a path to
 * a raw webhook payload saved from a real delivery.
 */
export async function readReplaySource(
  source: string,
  cwd = process.cwd(),
): Promise<{ provider?: ProviderId; payload: Record<string, unknown>; origin: string }> {
  const candidates = [
    join(logDir(cwd), `${source}.json`),
    join(logDir(cwd), source),
    resolve(cwd, source),
  ];
  for (const path of candidates) {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new PaylocalError(`${path} is not valid JSON`);
    }
    if (isLogEntry(parsed)) {
      return { provider: parsed.provider, payload: parsed.payload, origin: path };
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { payload: parsed as Record<string, unknown>, origin: path };
    }
    throw new PaylocalError(`${path} does not contain a JSON object`);
  }
  throw new PaylocalError(
    `Could not find "${source}"`,
    `Pass a log id from "paylocal log" or a path to a JSON payload`,
  );
}
