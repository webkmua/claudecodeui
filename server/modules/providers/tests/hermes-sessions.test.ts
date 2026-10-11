import assert from 'node:assert/strict';
import test from 'node:test';

import { HermesSessionsProvider } from '@/modules/providers/list/hermes/hermes-sessions.provider.js';

test('HermesSessionsProvider normalizes ACP agent_message_chunk', () => {
  const provider = new HermesSessionsProvider();
  const raw = {
    sessionId: 'session-123',
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { text: 'Hello, operator!', type: 'text' },
      messageId: 'msg-456',
    },
  };

  const messages = provider.normalizeMessage(raw, 'session-123');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'stream_delta');
  assert.equal(messages[0].content, 'Hello, operator!');
  assert.equal(messages[0].sessionId, 'session-123');
  assert.equal(messages[0].provider, 'hermes');
});

test('HermesSessionsProvider normalizes ACP agent_thought_chunk', () => {
  const provider = new HermesSessionsProvider();
  const raw = {
    sessionId: 'session-123',
    update: {
      sessionUpdate: 'agent_thought_chunk',
      content: { text: 'Thinking about the answer...', type: 'text' },
      messageId: 'msg-456',
    },
  };

  const messages = provider.normalizeMessage(raw, 'session-123');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, 'thinking');
  assert.equal(messages[0].content, 'Thinking about the answer...');
  assert.equal(messages[0].provider, 'hermes');
});

test('HermesSessionsProvider normalizes ACP tool_call and tool_call_update', () => {
  const provider = new HermesSessionsProvider();
  const callRaw = {
    sessionId: 'session-123',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'tc-001',
      title: 'read_file: SKILL.md',
      toolName: 'read_file',
      rawInput: { path: 'SKILL.md' },
    },
  };

  const callMessages = provider.normalizeMessage(callRaw, 'session-123');
  assert.equal(callMessages.length, 1);
  assert.equal(callMessages[0].kind, 'tool_use');
  assert.equal(callMessages[0].toolName, 'read_file');
  assert.equal(callMessages[0].toolId, 'tc-001');

  const updateRaw = {
    sessionId: 'session-123',
    update: {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tc-001',
      status: 'completed',
      content: 'file contents here',
    },
  };

  const resultMessages = provider.normalizeMessage(updateRaw, 'session-123');
  assert.equal(resultMessages.length, 1);
  assert.equal(resultMessages[0].kind, 'tool_result');
  assert.equal(resultMessages[0].toolId, 'tc-001');
  assert.equal(resultMessages[0].content, 'file contents here');
  assert.equal(resultMessages[0].isError, false);
});

test('HermesSessionsProvider normalizes usage_update and plan', () => {
  const provider = new HermesSessionsProvider();
  const usageRaw = {
    sessionId: 'session-123',
    update: {
      sessionUpdate: 'usage_update',
      size: 1000000,
      used: 15000,
    },
  };

  const usageMessages = provider.normalizeMessage(usageRaw, 'session-123');
  assert.equal(usageMessages.length, 1);
  assert.equal(usageMessages[0].kind, 'status');
  assert.equal(usageMessages[0].text, 'token_budget');
  assert.deepEqual(usageMessages[0].tokenBudget, { size: 1000000, used: 15000 });

  const planRaw = {
    sessionId: 'session-123',
    update: {
      sessionUpdate: 'plan',
      entries: [
        { content: 'Step 1', status: 'completed' },
        { content: 'Step 2', status: 'in_progress' },
      ],
    },
  };

  const planMessages = provider.normalizeMessage(planRaw, 'session-123');
  assert.equal(planMessages.length, 1);
  assert.equal(planMessages[0].kind, 'status');
  assert.equal(planMessages[0].status, 'plan');
  assert.ok(planMessages[0].text?.includes('[completed] Step 1'));
  assert.ok(planMessages[0].text?.includes('[in_progress] Step 2'));
});
