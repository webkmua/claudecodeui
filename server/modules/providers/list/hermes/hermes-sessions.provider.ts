import fsSync from 'node:fs';

import Database from 'better-sqlite3';

import { sessionsDb } from '@/modules/database/index.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';
import { getHermesDatabasePath } from './hermes-data-root.js';

const PROVIDER = 'hermes';

type HermesMessageRow = {
  id: number;
  role: string;
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;
  tool_name: string | null;
  timestamp: number;
  reasoning: string | null;
  reasoning_content: string | null;
  finish_reason: string | null;
};

function formatContent(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readToolPayload(raw: AnyRecord): AnyRecord {
  return readObjectRecord(raw.toolCall)
    ?? readObjectRecord(raw.tool_call)
    ?? readObjectRecord(raw.tool)
    ?? raw;
}

function readTextContent(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return (typeof record.text === 'string' ? record.text : null)
      ?? (typeof record.content === 'string' ? record.content : null);
  }
  if (!Array.isArray(value)) {
    return null;
  }

  const chunks: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      chunks.push(entry);
      continue;
    }
    const record = readObjectRecord(entry);
    const text = readOptionalString(record?.text) ?? readOptionalString(record?.content);
    if (text) {
      chunks.push(text);
    }
  }

  return chunks.length ? chunks.join('\n') : null;
}

function normalizeHermesEvent(
  rawEvent: unknown,
  sessionId: string | null,
  { history = false }: { history?: boolean } = {},
): NormalizedMessage[] {
  const raw = readObjectRecord(rawEvent);
  if (!raw) {
    return [];
  }

  const update = readObjectRecord(raw.update);
  const target = update ?? raw;

  const eventSessionId = readOptionalString(raw.sessionId)
    ?? readOptionalString(raw.session_id)
    ?? readOptionalString(target.sessionId)
    ?? readOptionalString(target.session_id)
    ?? sessionId
    ?? null;
  const baseId = readOptionalString(target.messageId)
    ?? readOptionalString(target.message_id)
    ?? readOptionalString(raw.messageId)
    ?? readOptionalString(raw.id)
    ?? generateMessageId();
  const timestamp = normalizeProviderTimestamp(raw.timestamp ?? raw.created_at ?? raw.time ?? target.timestamp);
  const type = readOptionalString(target.sessionUpdate)
    ?? readOptionalString(target.session_update)
    ?? readOptionalString(target.type)
    ?? readOptionalString(target.event)
    ?? readOptionalString(target.kind)
    ?? readOptionalString(raw.type)
    ?? readOptionalString(raw.event)
    ?? '';

  if (['agent_message_chunk', 'text_delta'].includes(type)) {
    const content = readTextContent(target.content)
      ?? readOptionalString(target.text)
      ?? readOptionalString(target.delta)
      ?? '';
    if (!content) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'stream_delta',
      content,
    })];
  }

  if (['agent_message', 'assistant_message', 'message'].includes(type)) {
    const role = readOptionalString(target.role) === 'user' ? 'user' : 'assistant';
    const content = readTextContent(target.content)
      ?? readOptionalString(target.text)
      ?? readTextContent(readObjectRecord(target.message)?.content)
      ?? '';
    if (!content.trim()) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: history ? 'text' : role === 'assistant' ? 'stream_delta' : 'text',
      role: history || role === 'user' ? role : undefined,
      content,
    })];
  }

  if (['agent_thought_chunk', 'thought_delta', 'thinking', 'reasoning'].includes(type)) {
    const content = readTextContent(target.content) ?? readOptionalString(target.text) ?? readOptionalString(target.delta) ?? '';
    if (!content) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'thinking',
      content,
    })];
  }

  if (['tool_call', 'tool_use', 'tool_call_start'].includes(type)) {
    const tool = readToolPayload(target);
    const toolId = readOptionalString(target.toolCallId)
      ?? readOptionalString(target.tool_call_id)
      ?? readOptionalString(target.toolId)
      ?? readOptionalString(tool.toolCallId)
      ?? readOptionalString(tool.tool_call_id)
      ?? readOptionalString(tool.toolId)
      ?? readOptionalString(tool.id)
      ?? baseId;
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_use',
      toolName: readOptionalString(target.toolName)
        ?? readOptionalString(target.tool_name)
        ?? readOptionalString(target.title)
        ?? readOptionalString(target.name)
        ?? readOptionalString(tool?.name)
        ?? readOptionalString(tool?.title)
        ?? 'Tool',
      toolInput: target.rawInput
        ?? target.raw_input
        ?? target.input
        ?? target.arguments
        ?? target.params
        ?? tool?.rawInput
        ?? tool?.raw_input
        ?? tool?.input
        ?? tool?.arguments
        ?? {},
      toolId,
    })];
  }

  if (['tool_call_update', 'tool_result', 'tool_call_result', 'tool_call_done'].includes(type)) {
    const tool = readToolPayload(target);
    const content = readTextContent(target.content)
      ?? readTextContent(target.rawOutput)
      ?? readTextContent(target.raw_output)
      ?? readTextContent(target.output)
      ?? readTextContent(target.result)
      ?? readTextContent(tool.rawOutput)
      ?? readTextContent(tool.raw_output)
      ?? readTextContent(tool.output)
      ?? readTextContent(tool.result)
      ?? '';
    const status = readOptionalString(target.status) ?? readOptionalString(tool.status);
    const isError = Boolean(target.error) || Boolean(tool.error) || status === 'error' || status === 'failed';
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'tool_result',
      toolId: readOptionalString(target.toolCallId)
        ?? readOptionalString(target.tool_call_id)
        ?? readOptionalString(target.toolId)
        ?? readOptionalString(tool.toolCallId)
        ?? readOptionalString(tool.tool_call_id)
        ?? readOptionalString(tool.toolId)
        ?? readOptionalString(tool.id)
        ?? '',
      content: content || formatContent(target.delta ?? ''),
      isError,
      toolUseResult: target.result ?? target.output ?? target.rawOutput ?? target.raw_output ?? tool.result ?? tool.output ?? tool.rawOutput ?? tool.raw_output,
    })];
  }

  if (type === 'plan') {
    const entries = Array.isArray(target.entries) ? target.entries : [];
    const content = entries.length > 0
      ? entries.map((e: any) => `[${e.status || 'pending'}] ${e.content || ''}`).join('\n')
      : readOptionalString(target.content) ?? readOptionalString(target.text) ?? formatContent(target.plan);
    if (!content || !content.trim()) {
      return [];
    }
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'status',
      text: content,
      status: 'plan',
    })];
  }

  if (type === 'usage_update') {
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'status',
      text: 'token_budget',
      tokenBudget: {
        used: target.used,
        size: target.size,
      },
    })];
  }

  if (type === 'error') {
    return [createNormalizedMessage({
      id: baseId,
      sessionId: eventSessionId,
      timestamp,
      provider: PROVIDER,
      kind: 'error',
      content: readOptionalString(target.error) ?? readOptionalString(target.message) ?? 'Unknown Hermes error',
    })];
  }

  return [];
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readHermesHistoryFromDatabase(sessionId: string): NormalizedMessage[] {
  const normalized: NormalizedMessage[] = [];
  const dbPath = getHermesDatabasePath();
  if (!fsSync.existsSync(dbPath)) {
    return normalized;
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`
      SELECT id, role, content, tool_call_id, tool_calls, tool_name, timestamp, reasoning, reasoning_content, finish_reason
      FROM messages
      WHERE session_id = ? AND active = 1
      ORDER BY timestamp ASC, id ASC
    `).all(sessionId) as HermesMessageRow[];

    for (const row of rows) {
      const timestamp = new Date(row.timestamp * 1000).toISOString();
      const baseId = `hermes-${sessionId}-${row.id}`;

      const reasoning = row.reasoning_content || row.reasoning;
      if (reasoning?.trim()) {
        normalized.push(createNormalizedMessage({
          id: `${baseId}-thinking`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'thinking',
          content: reasoning,
        }));
      }

      for (const toolCall of parseJsonArray(row.tool_calls)) {
        const call = readObjectRecord(toolCall);
        const fn = readObjectRecord(call?.function);
        normalized.push(createNormalizedMessage({
          id: `${baseId}-tool-${readOptionalString(call?.id) ?? normalized.length}`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_use',
          toolName: readOptionalString(fn?.name) ?? readOptionalString(call?.name) ?? 'Tool',
          toolInput: fn?.arguments ?? call?.arguments ?? {},
          toolId: readOptionalString(call?.id) ?? `${baseId}-tool`,
        }));
      }

      if (row.role === 'tool') {
        normalized.push(createNormalizedMessage({
          id: `${baseId}-result`,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'tool_result',
          toolId: row.tool_call_id ?? '',
          content: row.content ?? '',
          isError: row.finish_reason === 'error',
        }));
        continue;
      }

      if (row.content?.trim()) {
        normalized.push(createNormalizedMessage({
          id: baseId,
          sessionId,
          timestamp,
          provider: PROVIDER,
          kind: 'text',
          role: row.role === 'user' ? 'user' : 'assistant',
          content: row.content,
        }));
      }
    }
  } finally {
    db.close();
  }

  return normalized;
}

export class HermesSessionsProvider implements IProviderSessions {
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    return normalizeHermesEvent(rawMessage, sessionId);
  }

  async fetchHistory(sessionId: string, options: FetchHistoryOptions = {}): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const row = sessionsDb.getSessionById(sessionId) ?? sessionsDb.getSessionByProviderSessionId(sessionId);
    const messages = readHermesHistoryFromDatabase(row?.provider_session_id ?? sessionId);

    const start = Math.max(0, offset);
    const pageLimit = limit === null ? null : Math.max(0, limit);
    const page = sliceTailPage(messages, pageLimit, start);
    return {
      messages: page.page,
      total: messages.length,
      hasMore: page.hasMore,
      offset: start,
      limit: pageLimit,
    };
  }
}
