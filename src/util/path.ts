import { PaylocalError } from "../errors.js";

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Sets `target.a.b.c = value`, creating intermediate objects as needed. */
export function setPath(target: Obj, path: string, value: unknown): void {
  const parts = path.split(".").filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new PaylocalError(`Invalid field path "${path}"`);
  }
  let node: Obj = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const next = node[part];
    if (isObject(next)) {
      node = next;
    } else {
      const created: Obj = {};
      node[part] = created;
      node = created;
    }
  }
  node[parts[parts.length - 1]!] = value;
}

/** Reads `target.a.b.c`, returning undefined when any segment is missing. */
export function getPath(target: Obj, path: string): unknown {
  let node: unknown = target;
  for (const part of path.split(".")) {
    if (!isObject(node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * Turns a CLI string into a JSON-ish value.
 *
 * - `true`, `false`, `null` become their JSON values
 * - numeric strings become numbers
 * - anything wrapped in `{}`, `[]` or `""` is parsed as JSON
 * - everything else stays a string
 */
export function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  const first = raw[0];
  const last = raw[raw.length - 1];
  const looksJson =
    (first === "{" && last === "}") ||
    (first === "[" && last === "]") ||
    (first === '"' && last === '"');
  if (looksJson) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Parses `data.amount=5000` into `["data.amount", 5000]`. */
export function parseAssignment(input: string): [string, unknown] {
  const eq = input.indexOf("=");
  if (eq <= 0) {
    throw new PaylocalError(
      `Expected path=value but got "${input}"`,
      "Example: --set data.amount=250000",
    );
  }
  return [input.slice(0, eq).trim(), coerce(input.slice(eq + 1))];
}
