import { describe, expect, it } from 'vitest';

import { resolveFrontendEnabledProviders } from '@/shared/providerCatalogFallback';

describe('resolveFrontendEnabledProviders', () => {
  it('preserves all providers when the allow-list is unset', () => {
    expect(resolveFrontendEnabledProviders()).toEqual([
      'claude',
      'cursor',
      'codex',
      'opencode',
      'zcode',
      'antigravity',
      'hermes',
    ]);
  });

  it('supports an Antigravity-only frontend', () => {
    expect(resolveFrontendEnabledProviders(' Antigravity, antigravity ')).toEqual(['antigravity']);
  });

  it('rejects unknown providers', () => {
    expect(() => resolveFrontendEnabledProviders('antigravity,unknown')).toThrow(/unknown/i);
  });
});
