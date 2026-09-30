import { randomBytes, randomInt } from "node:crypto";

import type { EventContext } from "../types.js";

export function randomId(): number {
  return randomInt(100_000, 999_999_999);
}

export function randomRef(prefix = "ref"): string {
  return `${prefix}_${randomBytes(6).toString("hex")}`;
}

export function randomCode(prefix: string): string {
  const raw = randomBytes(9)
    .toString("base64url")
    .replace(/[^A-Za-z0-9]/g, "");
  return `${prefix}_${raw.slice(0, 12)}`;
}

export function createContext(now: Date = new Date()): EventContext {
  return {
    now,
    id: randomId,
    ref: randomRef,
    code: randomCode,
  };
}
