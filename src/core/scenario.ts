import { PaylocalError } from "../errors.js";
import { getProvider, providerIds } from "../providers/index.js";
import type { BuiltEvent, ProviderId, ScenarioDefinition } from "../types.js";
import { buildEvent, fixture, type BuildOptions, type WebhookFixture } from "./build.js";

/**
 * The shortcuts and `set` describe the first notice. Every later notice takes its
 * reference, amount, customer and ids from the first, so a field set there carries through.
 */
export type ScenarioOptions = BuildOptions;

export function getScenario(providerId: string, name: string): ScenarioDefinition {
  const provider = getProvider(providerId);
  const definition = provider.scenarios[name];
  if (!definition) {
    throw new PaylocalError(
      `Unknown ${provider.name} scenario "${name}"`,
      `Run "paylocal scenarios ${provider.id}" to list them`,
    );
  }
  return definition;
}

export function listScenarios(
  providerId?: string,
): Array<{ provider: ProviderId; scenario: ScenarioDefinition }> {
  const ids: ProviderId[] = providerId ? [getProvider(providerId).id] : providerIds;
  return ids.flatMap((id) =>
    Object.values(getProvider(id).scenarios).map((scenario) => ({ provider: id, scenario })),
  );
}

/**
 * Builds the notices a provider sends over the life of one transaction, in the order
 * it sends them, sharing the reference, amount, customer and ids a real run would share.
 *
 * The shortcuts and `set` apply to the first notice. Every later notice takes its values from it.
 */
export function buildScenario(
  providerId: string,
  name: string,
  options: ScenarioOptions = {},
): BuiltEvent[] {
  const provider = getProvider(providerId);
  const definition = getScenario(providerId, name);
  const built: BuiltEvent[] = [];
  for (const [index, step] of definition.steps.entries()) {
    if (index === 0) {
      built.push(
        buildEvent(provider.id, step.event, { ...options, set: { ...step.set, ...options.set } }),
      );
      continue;
    }
    const payloads = built.map((event) => event.payload);
    const linked = step.link ? step.link(payloads[0]!, payloads) : {};
    built.push(
      buildEvent(provider.id, step.event, { now: options.now, set: { ...linked, ...step.set } }),
    );
  }
  return built;
}

/**
 * The same, as fixtures for a test suite.
 *
 * @example
 * const [charge, pending, processed] = scenario("paystack", "refund", { reference: "ORD-1042" });
 * await processed.send(url, secret); // the refund arrives first
 * await charge.send(url, secret);
 */
export function scenario(
  providerId: string,
  name: string,
  options: ScenarioOptions = {},
): WebhookFixture[] {
  return buildScenario(providerId, name, options).map(fixture);
}
