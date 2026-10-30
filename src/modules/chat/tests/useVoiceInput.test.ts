import assert from 'node:assert/strict';

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';

import { useVoiceInput } from '@/modules/chat/hooks/useVoiceInput';
import type {
  SpeechRecognitionErrorEventLike,
  SpeechRecognitionEventLike,
  SpeechRecognitionInstance,
} from '@/shared/webSpeechRecognition';

class MockSpeechRecognition extends EventTarget implements Partial<SpeechRecognitionInstance> {
  static latestInstance: MockSpeechRecognition | null = null;

  continuous = false;
  interimResults = false;
  lang = '';
  maxAlternatives = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null = null;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null = null;
  onspeechstart: (() => void) | null = null;
  onspeechend: (() => void) | null = null;
  onaudiostart: (() => void) | null = null;
  onaudioend: (() => void) | null = null;
  onnomatch: (() => void) | null = null;

  constructor() {
    super();
    MockSpeechRecognition.latestInstance = this;
  }

  start = vi.fn(() => {
    this.onstart?.();
  });

  stop = vi.fn(() => {
    this.onend?.();
  });

  abort = vi.fn(() => {
    this.onend?.();
  });

  emitResult(transcript: string, isFinal: boolean) {
    const event = {
      resultIndex: 0,
      results: [
        {
          0: { transcript, confidence: 1 },
          isFinal,
          length: 1,
          item: () => ({ transcript, confidence: 1 }),
        },
      ],
    } as unknown as SpeechRecognitionEventLike;
    this.onresult?.(event);
  }
}

describe('useVoiceInput Web Speech streaming', () => {
  let originalSpeechRecognition: unknown;

  beforeEach(() => {
    vi.useFakeTimers();
    MockSpeechRecognition.latestInstance = null;
    const win = window as unknown as Record<string, unknown>;
    originalSpeechRecognition = win.SpeechRecognition;
    win.SpeechRecognition = MockSpeechRecognition;
  });

  afterEach(() => {
    vi.useRealTimers();
    const win = window as unknown as Record<string, unknown>;
    if (originalSpeechRecognition !== undefined) {
      win.SpeechRecognition = originalSpeechRecognition;
    } else {
      delete win.SpeechRecognition;
    }
    vi.restoreAllMocks();
  });

  it('starts Web Speech recognition and notifies onStart', async () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const onStart = vi.fn();
    const onEnd = vi.fn();

    const { result } = renderHook(() =>
      useVoiceInput(onTranscript, onError, {
        webSpeechStreaming: true,
        lang: 'uk',
        onStart,
        onEnd,
      }),
    );

    assert.equal(result.current.state, 'idle');

    await act(async () => {
      result.current.toggle();
    });

    assert.equal(result.current.state, 'recording');
    assert.equal(onStart.mock.calls.length, 1);
    assert.equal(MockSpeechRecognition.latestInstance?.lang, 'uk-UA');
  });

  it('sets recognition language for Russian when configured', async () => {
    const { result } = renderHook(() =>
      useVoiceInput(vi.fn(), undefined, {
        webSpeechStreaming: true,
        lang: 'ru-RU',
      }),
    );

    await act(async () => {
      result.current.toggle();
    });

    assert.equal(MockSpeechRecognition.latestInstance?.lang, 'ru-RU');
  });

  it('streams interim and final transcripts in real time', async () => {
    const transcripts: Array<{ text: string; send?: boolean; isInterim?: boolean }> = [];
    const onTranscript = (text: string, send?: boolean, isInterim?: boolean) => {
      transcripts.push({ text, send, isInterim });
    };

    const { result } = renderHook(() =>
      useVoiceInput(onTranscript, undefined, {
        webSpeechStreaming: true,
      }),
    );

    await act(async () => {
      result.current.toggle();
    });

    const activeRec = MockSpeechRecognition.latestInstance;
    assert.ok(activeRec);

    // Emit interim result
    act(() => {
      activeRec?.emitResult('привіт', false);
    });

    assert.deepEqual(transcripts[0], {
      text: 'привіт',
      send: false,
      isInterim: true,
    });
    assert.equal(result.current.isSpeaking, true);

    // Emit final result
    act(() => {
      activeRec?.emitResult('привіт світ', true);
    });

    assert.deepEqual(transcripts[1], {
      text: 'привіт світ',
      send: false,
      isInterim: false,
    });
    assert.equal(result.current.isSpeaking, false);

    // Stop recording
    await act(async () => {
      result.current.stop({ manual: true });
    });

    assert.equal(result.current.state, 'idle');
  });

  it('handles stop with send: true and marks send on final transcript', async () => {
    const transcripts: Array<{ text: string; send?: boolean; isInterim?: boolean }> = [];

    const { result } = renderHook(() =>
      useVoiceInput(
        (text, send, isInterim) => {
          transcripts.push({ text, send, isInterim });
        },
        undefined,
        { webSpeechStreaming: true },
      ),
    );

    await act(async () => {
      result.current.toggle();
    });

    const activeRec = MockSpeechRecognition.latestInstance;
    assert.ok(activeRec);

    act(() => {
      activeRec?.emitResult('зроби тест', true);
    });

    // Tap send button (which calls stop({ send: true }))
    await act(async () => {
      result.current.stop({ send: true });
    });

    const last = transcripts[transcripts.length - 1];
    assert.equal(last.text, 'зроби тест');
    assert.equal(last.send, true);
    assert.equal(last.isInterim, false);
    assert.equal(result.current.state, 'idle');
  });

  it('triggers silence auto-commit when vadEnabled is true after speech pause', async () => {
    const { result } = renderHook(() =>
      useVoiceInput(vi.fn(), undefined, {
        webSpeechStreaming: true,
        vadEnabled: true,
        silenceTimeoutMs: 1200,
      }),
    );

    await act(async () => {
      result.current.toggle();
    });

    assert.equal(result.current.state, 'recording');

    const activeRec = MockSpeechRecognition.latestInstance;
    assert.ok(activeRec);

    act(() => {
      activeRec?.emitResult('коротке повідомлення', true);
    });

    // Advance timers by silenceTimeoutMs
    act(() => {
      vi.advanceTimersByTime(1300);
    });

    assert.equal(result.current.state, 'idle');
  });
});
