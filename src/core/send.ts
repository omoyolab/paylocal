import { PaylocalError } from "../errors.js";
import type { SendOptions, SendResult } from "../types.js";
import { version } from "../version.js";

export interface Deliverable {
  body: string;
  headers: Record<string, string>;
}

/** POSTs a signed body to `url` the way the provider would. */
export async function deliver(
  request: Deliverable,
  url: string,
  options: SendOptions = {},
): Promise<SendResult> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new PaylocalError(
      `"${url}" is not a valid URL`,
      "Example: --to http://localhost:3000/webhooks/paystack",
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": `paylocal/${version}`,
    ...options.headers,
    ...request.headers,
  };

  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(target, {
      method: "POST",
      headers,
      body: request.body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "manual",
    });
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    if (cause.name === "TimeoutError") {
      throw new PaylocalError(
        `No response from ${target.href} within ${timeoutMs}ms`,
        "Webhook handlers should respond quickly and do heavy work afterwards",
      );
    }
    throw new PaylocalError(
      `Could not connect to ${target.href}`,
      `Is your server running on port ${target.port || (target.protocol === "https:" ? "443" : "80")}?`,
    );
  }
  const durationMs = Math.round(performance.now() - started);
  const responseBody = await response.text().catch(() => "");

  return {
    url: target.href,
    status: response.status,
    ok: response.ok,
    durationMs,
    responseBody,
  };
}
