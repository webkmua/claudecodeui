import { AntigravityProvider } from '@/modules/providers/list/antigravity/antigravity.provider.js';
import { ClaudeProvider } from '@/modules/providers/list/claude/claude.provider.js';
import { CodexProvider } from '@/modules/providers/list/codex/codex.provider.js';
import { CursorProvider } from '@/modules/providers/list/cursor/cursor.provider.js';
import { HermesProvider } from '@/modules/providers/list/hermes/hermes.provider.js';
import { OpenCodeProvider } from '@/modules/providers/list/opencode/opencode.provider.js';
import { ZCodeProvider } from '@/modules/providers/list/zcode/zcode.provider.js';
import type { IProvider } from '@/shared/interfaces.js';
import type { LLMProvider } from '@/shared/types.js';
import { AppError } from '@/shared/utils.js';

import { resolveEnabledProviderIds } from './provider-availability.js';

const providerFactories: Record<LLMProvider, () => IProvider> = {
  claude: () => new ClaudeProvider(),
  codex: () => new CodexProvider(),
  cursor: () => new CursorProvider(),
  opencode: () => new OpenCodeProvider(),
  zcode: () => new ZCodeProvider(),
  antigravity: () => new AntigravityProvider(),
  hermes: () => new HermesProvider(),
};

const enabledProviderIds = resolveEnabledProviderIds();
const providers = new Map<LLMProvider, IProvider>(
  [...enabledProviderIds].map((providerId) => [providerId, providerFactories[providerId]()]),
);

/**
 * Central registry for resolving concrete provider implementations by id.
 */
export const providerRegistry = {
  listProviders(): IProvider[] {
    return [...providers.values()];
  },

  resolveProvider(provider: string): IProvider {
    const key = provider as LLMProvider;
    const resolvedProvider = providers.get(key);
    if (!resolvedProvider) {
      throw new AppError(`Provider "${provider}" is unavailable in this deployment.`, {
        code: 'PROVIDER_UNAVAILABLE',
        statusCode: 400,
      });
    }

    return resolvedProvider;
  },
};
