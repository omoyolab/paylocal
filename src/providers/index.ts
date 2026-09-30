import { PaylocalError } from "../errors.js";
import type { EventDefinition, Provider, ProviderId } from "../types.js";
import { flutterwave } from "./flutterwave.js";
import { paystack } from "./paystack.js";

export const providers: Record<ProviderId, Provider> = {
  paystack,
  flutterwave,
};

export const providerIds = Object.keys(providers) as ProviderId[];

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(providers, value);
}

export function getProvider(id: string): Provider {
  if (!isProviderId(id)) {
    throw new PaylocalError(
      `Unknown provider "${id}"`,
      `Supported providers: ${providerIds.join(", ")}`,
    );
  }
  return providers[id];
}

export function getEvent(providerId: string, eventName: string): EventDefinition {
  const provider = getProvider(providerId);
  const definition = provider.events[eventName];
  if (!definition) {
    throw new PaylocalError(
      `Unknown ${provider.name} event "${eventName}"`,
      `Run "paylocal events ${provider.id}" to list the events you can trigger`,
    );
  }
  return definition;
}

export function listEvents(
  providerId?: string,
): Array<{ provider: ProviderId; event: EventDefinition }> {
  const ids = providerId ? [getProvider(providerId).id] : providerIds;
  return ids.flatMap((id) =>
    Object.values(providers[id].events).map((event) => ({ provider: id, event })),
  );
}
