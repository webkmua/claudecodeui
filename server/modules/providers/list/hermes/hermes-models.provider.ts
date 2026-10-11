import { readFile } from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import { readOptionalString } from '@/shared/utils.js';
import { getHermesConfigPath, getHermesHome } from './hermes-data-root.js';

export const HERMES_CONFIGURED_MODEL = '__hermes_configured_model__';

export const HERMES_FALLBACK_MODELS: ProviderModelsDefinition = {
  OPTIONS: [
    {
      value: HERMES_CONFIGURED_MODEL,
      label: 'Use Hermes default',
      description: 'Uses the provider and model selected in Hermes.',
    },
  ],
  DEFAULT: HERMES_CONFIGURED_MODEL,
};

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  zai: 'Z.AI',
  'openai-codex': 'OpenAI Codex',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  'opencode-free': 'OpenCode Free',
  anthropic: 'Anthropic',
  google: 'Google',
  nous: 'Nous',
  openrouter: 'OpenRouter',
};

const CURATED_DEFAULT_MODELS: Array<{ value: string; label: string; description: string }> = [
  { value: 'zai:glm-5.3', label: 'glm-5.3 (Z.AI)', description: 'Hermes model via Z.AI' },
  { value: 'zai:glm-5.3-flash', label: 'glm-5.3-flash (Z.AI)', description: 'Hermes fast tier model via Z.AI' },
  { value: 'zai:glm-5.2', label: 'glm-5.2 (Z.AI)', description: 'Hermes model via Z.AI' },
  { value: 'openai-codex:gpt-5.6-sol', label: 'gpt-5.6-sol (OpenAI Codex)', description: 'Hermes model via OpenAI Codex' },
  { value: 'openai-codex:gpt-5.6-terra', label: 'gpt-5.6-terra (OpenAI Codex)', description: 'Hermes model via OpenAI Codex' },
  { value: 'openai-codex:gpt-5.5', label: 'gpt-5.5 (OpenAI Codex)', description: 'Hermes model via OpenAI Codex' },
  { value: 'deepseek:deepseek-v4-pro', label: 'deepseek-v4-pro (DeepSeek)', description: 'Hermes model via DeepSeek' },
  { value: 'xai:grok-4.6', label: 'grok-4.6 (xAI)', description: 'Hermes model via xAI' },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripScalar(raw: string): string | null {
  let value = raw.trim();
  // Drop an unquoted trailing comment.
  if (!value.startsWith('"') && !value.startsWith("'")) {
    const comment = value.search(/\s#/);
    if (comment >= 0) {
      value = value.slice(0, comment).trim();
    }
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim() || null;
}

const indentOf = (line: string): number => line.length - line.replace(/^\s+/, '').length;

// Minimal, indentation-aware reader for the flat `key: value` and one-level
// nested (`section:`\n`  key: value`) shapes used by ~/.hermes/config.yaml.
export function readYamlPath(content: string, pathParts: string[]): string | null {
  const lines = content.split(/\r?\n/);

  if (pathParts.length === 1) {
    const re = new RegExp(`^\\s*${escapeRegex(pathParts[0])}\\s*:\\s*(.*)$`);
    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const match = line.match(re);
      if (match) return stripScalar(match[1]);
    }
    return null;
  }

  const [section, key] = pathParts;
  const sectionRe = new RegExp(`^(\\s*)${escapeRegex(section)}\\s*:\\s*$`);
  const keyRe = new RegExp(`^\\s*${escapeRegex(key)}\\s*:\\s*(.*)$`);
  let sectionIndent: number | null = null;

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    if (sectionIndent === null) {
      const match = line.match(sectionRe);
      if (match) sectionIndent = match[1].length;
      continue;
    }

    // Left the nested block once indentation returns to the section level or less.
    if (indentOf(line) <= sectionIndent) {
      sectionIndent = line.match(sectionRe)?.[1].length ?? null;
      continue;
    }

    const match = line.match(keyRe);
    if (match) return stripScalar(match[1]);
  }

  return null;
}

export class HermesProviderModels implements IProviderModels {
  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    const activeModel = await this.readConfiguredModel();
    const activeProvider = await this.readConfiguredProvider();
    const dynamicModels = await this.readProviderModels(activeProvider);

    const defaultOption: ProviderModelOption = {
      value: HERMES_CONFIGURED_MODEL,
      label: 'Use Hermes default',
      description: activeModel
        ? `Uses the provider and model selected in Hermes. Current config: ${activeModel}${activeProvider ? ` (${activeProvider})` : ''}`
        : 'Uses the provider and model selected in Hermes.',
      isCustom: false,
    };

    return {
      OPTIONS: [defaultOption, ...dynamicModels],
      DEFAULT: HERMES_CONFIGURED_MODEL,
    };
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    const configured = await this.readConfiguredModel();
    return { model: configured ?? HERMES_CONFIGURED_MODEL };
  }

  private async readConfiguredModel(): Promise<string | null> {
    try {
      const content = await readFile(getHermesConfigPath(), 'utf8');
      return readOptionalString(readYamlPath(content, ['model', 'default']))
        ?? readOptionalString(readYamlPath(content, ['model']))
        ?? null;
    } catch {
      return null;
    }
  }

  private async readConfiguredProvider(): Promise<string | null> {
    try {
      const content = await readFile(getHermesConfigPath(), 'utf8');
      return readOptionalString(readYamlPath(content, ['model', 'provider'])) ?? null;
    } catch {
      return null;
    }
  }

  private async readProviderModels(activeProvider?: string | null): Promise<ProviderModelOption[]> {
    const models: ProviderModelOption[] = [];
    const seen = new Set<string>();

    try {
      const cachePath = path.join(getHermesHome(), 'provider_models_cache.json');
      if (fsSync.existsSync(cachePath)) {
        const raw = await readFile(cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const providerKeys = Object.keys(parsed).sort((a, b) => {
            if (activeProvider && a === activeProvider) return -1;
            if (activeProvider && b === activeProvider) return 1;
            return a.localeCompare(b);
          });

          for (const p of providerKeys) {
            const entry = parsed[p];
            const list = Array.isArray(entry?.models) ? entry.models : [];
            const pLabel = PROVIDER_DISPLAY_NAMES[p] || p;

            for (const m of list) {
              if (typeof m !== 'string' || !m.trim()) continue;
              const val = `${p}:${m}`;
              if (seen.has(val)) continue;
              seen.add(val);

              models.push({
                value: val,
                label: `${m} (${pLabel})`,
                description: `Hermes model via ${pLabel}`,
                isCustom: false,
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn('[HermesModels] Failed to read provider models cache:', error);
    }

    if (models.length === 0) {
      return CURATED_DEFAULT_MODELS.map((item) => ({ ...item, isCustom: false }));
    }

    return models;
  }
}
