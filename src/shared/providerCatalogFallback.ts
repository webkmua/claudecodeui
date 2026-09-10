/**
 * Frontend fallback mirror of the backend provider capability catalog
 * (server/modules/providers/services/provider-capabilities.catalog.ts).
 *
 * The backend catalog is the source of truth; this mirror exists so the
 * composer renders sensible defaults on first paint and when the
 * capabilities request fails. Its values are pinned to the backend catalog
 * by the cross-tree parity test
 * (server/modules/providers/tests/provider-catalog-parity.test.ts), so a
 * backend capability or default-model change that forgets this file fails
 * CI instead of shipping stale first-paint values — three default models
 * had already drifted exactly that way before the test existed.
 *
 * Zero imports on purpose: the parity test compiles this file from the
 * server tree, where the frontend `@` alias does not resolve.
 *
 * Consumers: useChatProviderState (fallback defaults + the provider order
 * used for catalog fetches and localStorage validation). The provider
 * order declared by this object's key order is the app-wide canonical one.
 */

export const PROVIDER_FALLBACK_CATALOG = {
  claude: {
    defaultModel: 'default',
    permissionModes: ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'],
  },
  cursor: {
    defaultModel: 'auto',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  },
  codex: {
    defaultModel: 'gpt-6.1-sol',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions'],
  },
  opencode: {
    defaultModel: 'opencode/gpt-5.6-terra',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  },
  zcode: {
    defaultModel: 'GLM-5.3',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  },
  antigravity: {
    defaultModel: 'gemini-3.7-flash',
    permissionModes: ['default', 'acceptEdits', 'bypassPermissions', 'plan'],
  },
};

export type ProviderCatalogId = keyof typeof PROVIDER_FALLBACK_CATALOG;

/** Canonical provider order (the catalog's key order). */
export const PROVIDER_FALLBACK_ORDER = Object.keys(PROVIDER_FALLBACK_CATALOG) as ProviderCatalogId[];

const KNOWN_PROVIDER_IDS = new Set<string>(PROVIDER_FALLBACK_ORDER);

/**
 * Used by the provider-facing UI and its tests to validate the deployment
 * allow-list injected by Vite. Blank configuration preserves the full UI.
 */
export function resolveFrontendEnabledProviders(configured?: string): ProviderCatalogId[] {
  if (!configured?.trim()) {
    return [...PROVIDER_FALLBACK_ORDER];
  }

  const requested = new Set(
    configured
      .split(',')
      .map((provider) => provider.trim().toLowerCase())
      .filter(Boolean),
  );
  const unknown = [...requested].filter((provider) => !KNOWN_PROVIDER_IDS.has(provider));
  if (unknown.length > 0) {
    throw new Error(`Unknown provider(s) in CLOUDCLI_ENABLED_PROVIDERS: ${unknown.join(', ')}`);
  }

  return PROVIDER_FALLBACK_ORDER.filter((provider) => requested.has(provider));
}

const configuredProviders = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env?.VITE_CLOUDCLI_ENABLED_PROVIDERS;

/** Providers exposed by this frontend build, in canonical catalog order. */
export const ENABLED_PROVIDER_ORDER = resolveFrontendEnabledProviders(configuredProviders);

/** Initial provider used before persisted preferences or session data load. */
export const DEFAULT_ENABLED_PROVIDER: ProviderCatalogId = ENABLED_PROVIDER_ORDER[0] ?? 'claude';
