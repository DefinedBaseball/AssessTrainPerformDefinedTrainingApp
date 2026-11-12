/**
 * Outside companies that can send data into the app. Each one gets its own
 * API keys (Settings -> Integrations) and its own path:
 *
 *   POST /api/integrations/<provider>/<kind>
 *
 * A key belongs to exactly ONE provider, so a MOVE key can only post to
 * /integrations/move/... -- never to another company's path. Adding a company
 * later is one entry here plus its handler; the keys, the ping endpoint and
 * the delivery log are shared.
 */
export interface IntegrationProvider {
  /** URL slug -- permanent once a developer is using it. */
  slug: string;
  label: string;
  /** What this provider can send: the last path segment. */
  kinds: string[];
}

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  { slug: 'move', label: 'MOVE Catching Sensor', kinds: ['sessions'] },
];

export function providerBySlug(slug: string): IntegrationProvider | undefined {
  return INTEGRATION_PROVIDERS.find((p) => p.slug === slug);
}
