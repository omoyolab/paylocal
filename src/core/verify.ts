import { getProvider } from "../providers/index.js";
import type { SendOptions, VerifyResult } from "../types.js";
import { buildEvent, signEvent } from "./build.js";
import { deliver } from "./send.js";

export interface VerifyOptions extends SendOptions {
  /** Event to use for the probe. Defaults to the provider's `verifyEvent`. */
  event?: string;
}

/**
 * Sends one correctly signed event and one tampered event to `url` and reports
 * whether the endpoint distinguishes between them.
 */
export async function verifyEndpoint(
  providerId: string,
  url: string,
  secret: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const provider = getProvider(providerId);
  const eventName = options.event ?? provider.verifyEvent;
  const signed = signEvent(buildEvent(provider.id, eventName), secret);
  const tampered = provider.tamper(signed.body, signed.headers);

  const valid = await deliver({ body: signed.body, headers: signed.headers }, url, options);
  const bad = await deliver({ body: tampered.body, headers: tampered.headers }, url, options);

  const notes: string[] = [];
  let verdict: VerifyResult["verdict"];

  if (!valid.ok) {
    verdict = "inconclusive";
    notes.push(
      `The correctly signed event was rejected with HTTP ${valid.status}. ` +
        `Check that --secret matches the ${provider.secretLabel} your server uses, and that --to is the right route.`,
    );
  } else if (bad.ok) {
    verdict = "not-verified";
    notes.push(
      `The endpoint accepted a request whose ${tampered.description}. ` +
        `Anyone who can reach this URL can fake a ${provider.name} event.`,
    );
    notes.push(
      `Compare the ${provider.signatureHeader} header before trusting the payload. See ${provider.docs}`,
    );
  } else {
    verdict = "verified";
    notes.push(
      `Valid event accepted (HTTP ${valid.status}), tampered event rejected (HTTP ${bad.status}).`,
    );
    if (provider.id === "flutterwave") {
      notes.push(
        "Flutterwave v3 only checks a shared secret header, not the body. Treat the payload as a hint and confirm with the verify-transaction API.",
      );
    }
  }

  return {
    provider: provider.id,
    event: eventName,
    url: valid.url,
    valid,
    tampered: bad,
    tamperDescription: tampered.description,
    verdict,
    notes,
  };
}
