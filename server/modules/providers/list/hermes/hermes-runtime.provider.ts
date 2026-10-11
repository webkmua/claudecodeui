import crypto from 'node:crypto';

import { notifyRunFailed, notifyRunStopped } from '@/modules/notifications/index.js';
import type { IProviderRuntime } from '@/shared/interfaces.js';
import type {
  AnyRecord,
  ProviderPermissionDecision,
  ProviderRuntimeContext,
  ProviderRuntimePermissionGateway,
  ProviderRuntimeWriter,
} from '@/shared/types.js';
import {
  appendFilesInputTag,
  appendImagesInputTag,
  normalizeAttachmentDescriptors,
} from '@/shared/image-attachments.js';
import { createCompleteMessage, createNormalizedMessage } from '@/shared/utils.js';
import { HERMES_CONFIGURED_MODEL } from './hermes-models.provider.js';
import { hermesConnectionManager, type AcpClient } from './hermes-acp-client.js';

const PROVIDER = 'hermes';

type ActiveHermesSession = {
  connection: AcpClient;
  sessionId: string | null;
  status: 'active' | 'aborted' | 'completed';
  aborted: boolean;
  writer: ProviderRuntimeWriter;
  sessionSummary?: string;
};

type PendingApproval = {
  requestId: string;
  sessionId: string | null;
  resolver: (decision: ProviderPermissionDecision) => void;
  toolName: string;
  input: unknown;
  context: unknown;
  receivedAt: Date;
};

const activeHermesSessions = new Map<string, ActiveHermesSession>();
const abortedSessionIds = new Set<string>();
const pendingApprovals = new Map<string, PendingApproval>();

function createRequestId(): string {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function readSessionId(result: any): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result.sessionId
    || result.session_id
    || result.id
    || result.session?.id
    || result.session?.sessionId
    || result.session?.session_id
    || null;
}

function readStopReason(result: any): string | null {
  if (!result || typeof result !== 'object') {
    return null;
  }
  return result.stopReason || result.stop_reason || result.reason || null;
}

function buildPromptParams(sessionId: string, command: string) {
  return {
    sessionId,
    prompt: [{ type: 'text', text: command }],
  };
}

function buildSessionSetupParams(sessionId: string | null, workingDir: string) {
  return {
    ...(sessionId ? { sessionId } : {}),
    cwd: workingDir,
    mcpServers: [],
  };
}

function canLoadSession(connection: AcpClient): boolean {
  const result = connection.initializeResult as any;
  return result?.agentCapabilities?.loadSession === true;
}

function findPermissionOption(options: any[], kinds: string[], fallbackOptionIds: string[] = []): string | null {
  if (!Array.isArray(options)) {
    return null;
  }

  for (const kind of kinds) {
    const match = options.find((option) => option?.kind === kind);
    if (match?.optionId) {
      return match.optionId;
    }
  }

  for (const optionId of fallbackOptionIds) {
    const match = options.find((option) => option?.optionId === optionId);
    if (match?.optionId) {
      return match.optionId;
    }
  }

  return null;
}

export function createPermissionDecision(decision: ProviderPermissionDecision, options: any[] = []): { outcome: any } {
  if (!decision || !decision.allow) {
    return { outcome: { outcome: 'cancelled' } };
  }

  if (decision.allow) {
    const optionId = decision.rememberEntry
      ? findPermissionOption(options, ['allow_always', 'allow_session'], ['allow_always', 'allow_session'])
      : findPermissionOption(options, ['allow_once'], ['allow_once']);

    if (!optionId) {
      return { outcome: { outcome: 'cancelled' } };
    }

    return {
      outcome: {
        outcome: 'selected',
        optionId,
      },
    };
  }

  const denyOptionId = findPermissionOption(options, ['reject_once', 'deny', 'reject_always'], ['deny', 'reject_once', 'reject_always']);
  if (denyOptionId) {
    return {
      outcome: {
        outcome: 'selected',
        optionId: denyOptionId,
      },
    };
  }

  return {
    outcome: { outcome: 'cancelled' },
  };
}

function registerApproval(
  requestId: string,
  approval: Omit<PendingApproval, 'requestId'>,
) {
  pendingApprovals.set(requestId, { ...approval, requestId });
}

function unregisterApproval(requestId: string) {
  pendingApprovals.delete(requestId);
}

function clearApprovalsForSession(sessionId: string | null) {
  if (!sessionId) return;
  for (const [requestId, entry] of pendingApprovals.entries()) {
    if (entry.sessionId === sessionId) {
      pendingApprovals.delete(requestId);
    }
  }
}

async function waitForPermission(
  writer: ProviderRuntimeWriter,
  params: any,
  capturedSessionId: string | null,
  sessionSummary?: string,
): Promise<{ outcome: any }> {
  const requestId = createRequestId();
  const toolCall = params?.toolCall || params?.tool_call || {};
  const toolName = params?.toolName
    || params?.tool_name
    || params?.name
    || params?.tool?.name
    || toolCall.title
    || 'HermesTool';
  const input = params?.input
    ?? params?.arguments
    ?? params?.toolInput
    ?? params?.tool_input
    ?? toolCall.rawInput
    ?? toolCall.raw_input
    ?? toolCall;

  writer.send(createNormalizedMessage({
    kind: 'permission_request',
    requestId,
    toolName,
    input,
    sessionId: capturedSessionId,
    provider: PROVIDER,
  }));

  return new Promise((resolve) => {
    registerApproval(requestId, {
      sessionId: capturedSessionId,
      toolName,
      input,
      context: params,
      receivedAt: new Date(),
      resolver: (decision) => {
        unregisterApproval(requestId);
        resolve(createPermissionDecision(decision, params?.options));
      },
    });
  });
}

export async function spawnHermes(
  command: string,
  options: AnyRecord = {},
  writer: ProviderRuntimeWriter,
  context: ProviderRuntimeContext,
): Promise<unknown> {
  const { sessionId, projectPath, cwd, model, sessionSummary, attachments, images, files } = options as any;
  const workingDir = cwd || projectPath || process.cwd();
  const requestedModel = model === HERMES_CONFIGURED_MODEL ? undefined : model;
  const existingProviderSessionId = sessionId
    ? context.resolveProviderSessionId(sessionId)
    : null;
  let capturedSessionId: string | null = null;
  let sessionCreatedSent = false;
  let completeSent = false;
  let activeKey = existingProviderSessionId || sessionId || `pending-${createRequestId()}`;

  // Process attachments (images / files)
  const normalizedAttachments = normalizeAttachmentDescriptors(attachments ?? images ?? []);
  const normalizedFiles = normalizeAttachmentDescriptors(files ?? []);
  let fullCommand = command;
  if (normalizedAttachments.length > 0) {
    fullCommand = appendImagesInputTag(fullCommand, normalizedAttachments);
  }
  if (normalizedFiles.length > 0) {
    fullCommand = appendFilesInputTag(fullCommand, normalizedFiles);
  }

  const notifyTerminalState = ({ error = null, stopReason = 'completed' }: { error?: unknown; stopReason?: string } = {}) => {
    const finalSessionId = capturedSessionId || existingProviderSessionId || sessionId || activeKey;
    if (!error) {
      notifyRunStopped({
        userId: writer?.userId != null ? String(writer.userId) : null,
        provider: PROVIDER,
        sessionId: finalSessionId,
        sessionName: sessionSummary,
        stopReason,
      });
      return;
    }

    notifyRunFailed({
      userId: writer?.userId != null ? String(writer.userId) : null,
      provider: PROVIDER,
      sessionId: finalSessionId,
      sessionName: sessionSummary,
      error,
    });
  };

  const registerSession = (nextSessionId: string | null, connection: AcpClient, isResumed = false) => {
    if (!nextSessionId) {
      return;
    }

    const previousKey = activeKey;
    activeKey = nextSessionId;
    capturedSessionId = nextSessionId;

    if (previousKey !== activeKey && activeHermesSessions.has(previousKey)) {
      activeHermesSessions.delete(previousKey);
    }
    activeHermesSessions.set(activeKey, {
      connection,
      sessionId: capturedSessionId,
      status: 'active',
      aborted: false,
      writer,
      sessionSummary,
    });

    if (writer.setSessionId && typeof writer.setSessionId === 'function') {
      writer.setSessionId(capturedSessionId);
    }

    if (!sessionCreatedSent && (!isResumed || sessionId !== capturedSessionId)) {
      sessionCreatedSent = true;
      writer.send(createNormalizedMessage({
        kind: 'session_created',
        newSessionId: capturedSessionId,
        sessionId: capturedSessionId,
        provider: PROVIDER,
      }));
    }
  };

  try {
    await context.resolveResumeModel(sessionId, requestedModel);
    const connection = await hermesConnectionManager.getConnection(workingDir);
    activeHermesSessions.set(activeKey, {
      connection,
      sessionId: capturedSessionId,
      status: 'active',
      aborted: false,
      writer,
      sessionSummary,
    });

    const unregisterPermissionHandler = connection.registerRequestHandler('session/request_permission', (params: any) => {
      const permissionSessionId = params?.sessionId || params?.session_id || null;
      const active = permissionSessionId
        ? activeHermesSessions.get(permissionSessionId)
        : activeHermesSessions.get(activeKey);
      if (!active) {
        return { outcome: { outcome: 'cancelled' } };
      }

      return waitForPermission(
        active.writer,
        params,
        active.sessionId || permissionSessionId || capturedSessionId,
        active.sessionSummary || sessionSummary,
      );
    });

    let isLiveTurn = false;
    const updateHandler = (params: any) => {
      if (!isLiveTurn) {
        return;
      }
      const updateSessionId = params?.sessionId || params?.session_id || null;
      if (capturedSessionId && updateSessionId && updateSessionId !== capturedSessionId) {
        return;
      }

      registerSession(updateSessionId, connection, true);
      const normalized = context.normalizeMessage(params, capturedSessionId || updateSessionId || null);
      for (const msg of normalized) {
        writer.send(msg);
      }
    };

    try {
      let isResumed = false;
      if (existingProviderSessionId && canLoadSession(connection)) {
        try {
          const loadResult = await connection.request('session/load', buildSessionSetupParams(existingProviderSessionId, workingDir));
          if (loadResult && typeof loadResult === 'object' && Object.keys(loadResult).length > 0) {
            registerSession(existingProviderSessionId, connection, true);
            isResumed = true;
          }
        } catch (loadError) {
          console.warn(`[HermesRuntime] session/load failed for "${existingProviderSessionId}":`, loadError);
        }
      }

      if (!isResumed) {
        const newResult = await connection.request('session/new', buildSessionSetupParams(null, workingDir));
        const newSessionId = readSessionId(newResult);
        if (!newSessionId) {
          throw new Error('Hermes ACP did not return a session id for session/new.');
        }
        registerSession(newSessionId, connection, false);
      }

      if (!capturedSessionId) {
        throw new Error('Hermes ACP did not establish a valid session id.');
      }

      if (requestedModel) {
        try {
          await connection.request('session/set_model', {
            sessionId: capturedSessionId,
            modelId: requestedModel,
          });
        } catch (switchError) {
          console.warn(`[HermesRuntime] Failed to set session model to "${requestedModel}":`, switchError);
        }
      }

      // Attach session/update listener strictly for the live prompt turn
      // (prevents history replay emitted during session/load from duplicating into the new turn)
      isLiveTurn = true;
      connection.on('session/update', updateHandler);

      let promptResult: any;
      try {
        promptResult = await connection.request('session/prompt', buildPromptParams(capturedSessionId, fullCommand));
      } finally {
        isLiveTurn = false;
        connection.off('session/update', updateHandler);
      }
      const stopReason = readStopReason(promptResult) || 'completed';

      if (stopReason === 'refusal') {
        throw new Error(`Hermes agent refused prompt for session "${capturedSessionId}".`);
      }

      const finalSessionId = capturedSessionId || readSessionId(promptResult) || existingProviderSessionId || sessionId || activeKey;
      const active = activeHermesSessions.get(finalSessionId) || activeHermesSessions.get(activeKey);

      if (promptResult?.usage || promptResult?.tokenUsage || promptResult?.token_usage) {
        writer.send(createNormalizedMessage({
          kind: 'status',
          text: 'token_budget',
          tokenBudget: promptResult.usage || promptResult.tokenUsage || promptResult.token_usage,
          sessionId: finalSessionId,
          provider: PROVIDER,
        }));
      }

      const abortedById = abortedSessionIds.delete(finalSessionId);
      const abortedByKey = abortedSessionIds.delete(activeKey);
      const wasAborted = Boolean(active?.aborted || abortedById || abortedByKey);

      if (!completeSent && !wasAborted) {
        completeSent = true;
        writer.send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: 0 }));
      }
      activeHermesSessions.delete(finalSessionId);
      activeHermesSessions.delete(activeKey);
      clearApprovalsForSession(finalSessionId);
      notifyTerminalState({ stopReason: wasAborted ? 'aborted' : stopReason });
      return promptResult;
    } finally {
      connection.off('session/update', updateHandler);
      unregisterPermissionHandler();
    }
  } catch (error) {
    const finalSessionId = capturedSessionId || existingProviderSessionId || sessionId || activeKey;
    const abortedById = abortedSessionIds.delete(finalSessionId);
    const abortedByKey = abortedSessionIds.delete(activeKey);
    activeHermesSessions.delete(finalSessionId);
    activeHermesSessions.delete(activeKey);
    clearApprovalsForSession(finalSessionId);

    if (abortedById || abortedByKey) {
      return;
    }

    const installed = await context.isProviderInstalled();
    const errorContent = !installed
      ? 'Hermes ACP is not installed. Install Hermes and ensure hermes-acp is on PATH.'
      : error instanceof Error ? error.message : String(error);

    writer.send(createNormalizedMessage({
      kind: 'error',
      content: errorContent,
      sessionId: finalSessionId,
      provider: PROVIDER,
    }));
    if (!completeSent) {
      completeSent = true;
      writer.send(createCompleteMessage({ provider: PROVIDER, sessionId: finalSessionId, exitCode: 1 }));
    }
    notifyTerminalState({ error });
    throw error;
  }
}

export function abortHermesSession(providerSessionId: string): boolean {
  const active = activeHermesSessions.get(providerSessionId);
  if (!active) {
    return false;
  }

  active.aborted = true;
  active.status = 'aborted';
  abortedSessionIds.add(providerSessionId);
  if (active.sessionId) {
    abortedSessionIds.add(active.sessionId);
  }
  for (const entry of pendingApprovals.values()) {
    if (entry.sessionId === (active.sessionId || providerSessionId)) {
      entry.resolver({ allow: false });
    }
  }

  try {
    active.connection.notify('session/cancel', { sessionId: active.sessionId || providerSessionId });
  } catch {
    // Session already closed.
  }
  activeHermesSessions.delete(providerSessionId);
  return true;
}

export const hermesRuntimePermissions: ProviderRuntimePermissionGateway = {
  resolve(requestId: string, decision: ProviderPermissionDecision): void {
    const approval = pendingApprovals.get(requestId);
    if (approval) {
      approval.resolver(decision);
    }
  },

  listPending(sessionId: string): unknown[] {
    const list: unknown[] = [];
    for (const [requestId, entry] of pendingApprovals.entries()) {
      if (entry.sessionId === sessionId) {
        list.push({
          requestId,
          toolName: entry.toolName,
          input: entry.input,
          context: entry.context,
          sessionId,
          provider: PROVIDER,
          receivedAt: entry.receivedAt,
        });
      }
    }
    return list;
  },
};

export const hermesRuntime: IProviderRuntime = {
  run: spawnHermes,
  abort: abortHermesSession,
  permissions: hermesRuntimePermissions,
};
