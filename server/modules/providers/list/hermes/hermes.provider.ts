import { HermesProviderAuth } from '@/modules/providers/list/hermes/hermes-auth.provider.js';
import { HermesMcpProvider } from '@/modules/providers/list/hermes/hermes-mcp.provider.js';
import { HermesProviderModels } from '@/modules/providers/list/hermes/hermes-models.provider.js';
import { hermesRuntime } from '@/modules/providers/list/hermes/hermes-runtime.provider.js';
import { HermesSessionSynchronizer } from '@/modules/providers/list/hermes/hermes-session-synchronizer.provider.js';
import { HermesSessionsProvider } from '@/modules/providers/list/hermes/hermes-sessions.provider.js';
import { HermesSkillsProvider } from '@/modules/providers/list/hermes/hermes-skills.provider.js';
import { AbstractProvider } from '@/modules/providers/shared/base/abstract.provider.js';
import type {
  IProviderAuth,
  IProviderModels,
  IProviderRuntime,
  IProviderSessionSynchronizer,
  IProviderSkills,
  IProviderSessions,
} from '@/shared/interfaces.js';

export class HermesProvider extends AbstractProvider {
  readonly runtime: IProviderRuntime = hermesRuntime;
  readonly models: IProviderModels = new HermesProviderModels();
  readonly mcp = new HermesMcpProvider();
  readonly auth: IProviderAuth = new HermesProviderAuth();
  readonly skills: IProviderSkills = new HermesSkillsProvider();
  readonly sessions: IProviderSessions = new HermesSessionsProvider();
  readonly sessionSynchronizer: IProviderSessionSynchronizer = new HermesSessionSynchronizer();

  constructor() {
    super('hermes');
  }
}
