import { getProvider } from "../providers/index.js";
import type { ProbeOutcome, SendOptions, SendResult, VerifyProbe, VerifyResult } from "../types.js";
import { buildEvent, signEvent } from "./build.js";
import { deliver } from "./send.js";

export interface VerifyOptions extends SendOptions {
  /** Event to use for the probe. Defaults to the provider's `verifyEvent`. */
  event?: string;
}

function outcomeOf(result: SendResult): ProbeOutcome {
  if (result.ok) return "accepted";
  return result.status >= 500 ? "crashed" : "rejected";
}

/**
 * Sends one correctly signed event, then every kind of request the endpoint should
 * refuse: one with no signature, one signed with the wrong secret and, for a provider
 * that signs the body, one whose body was changed after signing.
 *
 * The endpoint is verified when it accepts the first and refuses each of the others
 * with a 4xx. Accepting one means anyone can fake an event. Answering one with a 5xx
 * means the handler broke on input anyone can send, and the provider would keep
 * resending a real event that hit the same fault.
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
  const header = provider.signatureHeader;

  const unsignedHeaders = { ...signed.headers };
  delete unsignedHeaders[header];

  const forgeries: Array<{
    name: string;
    description: string;
    body: string;
    headers: Record<string, string>;
  }> = [
    {
      name: "no-signature",
      description: `no ${header} header`,
      body: signed.body,
      headers: unsignedHeaders,
    },
    {
      name: "wrong-secret",
      description: provider.signsBody
        ? `${header} made with a different secret`
        : `${header} set to a different value`,
      body: signed.body,
      headers: { ...signed.headers, ...provider.sign(signed.body, `${secret}-not-yours`) },
    },
  ];
  if (provider.signsBody) {
    const tampered = provider.tamper(signed.body, signed.headers);
    forgeries.push({
      name: "changed-body",
      description: tampered.description,
      body: tampered.body,
      headers: tampered.headers,
    });
  }

  const valid = await deliver({ body: signed.body, headers: signed.headers }, url, options);
  const probes: VerifyProbe[] = [];
  for (const forgery of forgeries) {
    const result = await deliver({ body: forgery.body, headers: forgery.headers }, url, options);
    probes.push({
      name: forgery.name,
      description: forgery.description,
      result,
      outcome: outcomeOf(result),
    });
  }

  const accepted = probes.filter((probe) => probe.outcome === "accepted");
  const crashed = probes.filter((probe) => probe.outcome === "crashed");
  const notes: string[] = [];
  let verdict: VerifyResult["verdict"];

  if (!valid.ok) {
    verdict = "inconclusive";
    notes.push(
      `The correctly signed event was rejected with HTTP ${valid.status}. ` +
        `Check that --secret matches the ${provider.secretLabel} your server uses, and that --to is the right route.`,
    );
  } else if (accepted.length > 0) {
    verdict = "not-verified";
    for (const probe of accepted) {
      notes.push(`The endpoint accepted a request with ${probe.description}.`);
    }
    notes.push(`Anyone who can reach this URL can fake a ${provider.name} event.`);
    notes.push(`Compare the ${header} header before trusting the payload. See ${provider.docs}`);
  } else if (crashed.length > 0) {
    verdict = "not-verified";
    for (const probe of crashed) {
      notes.push(
        `The endpoint answered HTTP ${probe.result.status} to a request with ${probe.description}. It broke where it should have refused.`,
      );
    }
    notes.push(
      "Refuse a bad signature with a 401 before doing anything else. A comparison that throws on a missing or short header is the usual cause.",
    );
  } else {
    verdict = "verified";
    notes.push(
      `Valid event accepted (HTTP ${valid.status}), ${probes.length} forged requests refused.`,
    );
    if (!provider.signsBody) {
      notes.push(
        `${provider.name} v3 only checks a shared secret header, not the body. Treat the payload as a hint and confirm with the verify-transaction API.`,
      );
    }
  }

  const last = probes[probes.length - 1]!;
  return {
    provider: provider.id,
    event: eventName,
    url: valid.url,
    valid,
    probes,
    tampered: last.result,
    tamperDescription: last.description,
    verdict,
    notes,
  };
}
