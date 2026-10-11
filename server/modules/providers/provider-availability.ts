import type { LLMProvider } from '@/shared/types.js';

const ALL_PROVIDER_IDS: readonly LLMProvider[] = [
  'claude',
  'codex',
  'cursor',
  'opencode',
  'zcode',
  'antigravity',
  'hermes',
];

const KNOWN_PROVIDER_IDS = new Set<string>(ALL_PROVIDER_IDS);

/**
 * Consumed by the provider registry and its tests to turn the optional
 * CLOUDCLI_ENABLED_PROVIDERS CSV into an ordered, validated provider set.
 * An unset or blank value preserves the full upstream provider registry.
 */
export function resolveEnabledProviderIds(
  configured = process.env.CLOUDCLI_ENABLED_PROVIDERS,
): ReadonlySet<LLMProvider> {
  if (!configured?.trim()) {
    return new Set(ALL_PROVIDER_IDS);
  }

  const requested = configured
    .split(',')
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
  const unknown = requested.filter((provider) => !KNOWN_PROVIDER_IDS.has(provider));

  if (unknown.length > 0) {
    throw new Error(`Unknown provider(s) in CLOUDCLI_ENABLED_PROVIDERS: ${unknown.join(', ')}`);
  }

  return new Set(requested as LLMProvider[]);
}
