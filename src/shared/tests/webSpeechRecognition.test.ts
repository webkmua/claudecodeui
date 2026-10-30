import assert from 'node:assert/strict';

import { afterEach, describe, it, vi } from 'vitest';

import {
  appendWithSpace,
  getSpeechRecognitionConstructor,
  isWebSpeechSupported,
  resolveRecognitionLanguage,
  VOICE_LANGUAGE_OPTIONS,
  type SpeechRecognitionInstance,
} from '@/shared/webSpeechRecognition';

describe('webSpeechRecognition utils', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('appendWithSpace', () => {
    it('returns empty string when both inputs are empty', () => {
      assert.equal(appendWithSpace('', ''), '');
      assert.equal(appendWithSpace('   ', '   '), '');
    });

    it('returns b if a is empty', () => {
      assert.equal(appendWithSpace('', 'hello'), 'hello');
      assert.equal(appendWithSpace('   ', 'hello'), 'hello');
    });

    it('returns a if b is empty', () => {
      assert.equal(appendWithSpace('hello', ''), 'hello');
      assert.equal(appendWithSpace('hello', '   '), 'hello');
    });

    it('concatenates two strings with a single space', () => {
      assert.equal(appendWithSpace('hello', 'world'), 'hello world');
      assert.equal(appendWithSpace('hello ', ' world'), 'hello world');
      assert.equal(appendWithSpace('  hello  ', '  world  '), 'hello world');
    });
  });

  describe('resolveRecognitionLanguage', () => {
    it('maps known short language codes to full BCP-47 tags', () => {
      assert.equal(resolveRecognitionLanguage('uk'), 'uk-UA');
      assert.equal(resolveRecognitionLanguage('ru'), 'ru-RU');
      assert.equal(resolveRecognitionLanguage('en'), 'en-US');
      assert.equal(resolveRecognitionLanguage('es'), 'es-ES');
      assert.equal(resolveRecognitionLanguage('de'), 'de-DE');
      assert.equal(resolveRecognitionLanguage('fr'), 'fr-FR');
      assert.equal(resolveRecognitionLanguage('ja'), 'ja-JP');
      assert.equal(resolveRecognitionLanguage('ko'), 'ko-KR');
      assert.equal(resolveRecognitionLanguage('zh-CN'), 'zh-CN');
    });

    it('preserves valid custom BCP-47 tags with hyphen', () => {
      assert.equal(resolveRecognitionLanguage('en-GB'), 'en-GB');
      assert.equal(resolveRecognitionLanguage('uk-UA'), 'uk-UA');
      assert.equal(resolveRecognitionLanguage('ru-RU'), 'ru-RU');
      assert.equal(resolveRecognitionLanguage('pt-BR'), 'pt-BR');
    });

    it('falls back to navigator.language or uk-UA if unsupplied', () => {
      const resolved = resolveRecognitionLanguage();
      assert.ok(typeof resolved === 'string' && resolved.length > 0);
    });

    it('resolves navigator.languages when preferredLang is auto', () => {
      const origLanguages = navigator.languages;
      try {
        Object.defineProperty(navigator, 'languages', {
          value: ['ru-RU', 'en-US'],
          configurable: true,
        });
        assert.equal(resolveRecognitionLanguage('auto'), 'ru-RU');

        Object.defineProperty(navigator, 'languages', {
          value: ['uk'],
          configurable: true,
        });
        assert.equal(resolveRecognitionLanguage('auto'), 'uk-UA');
      } finally {
        Object.defineProperty(navigator, 'languages', {
          value: origLanguages,
          configurable: true,
        });
      }
    });

    it('includes required voice language options', () => {
      const values = VOICE_LANGUAGE_OPTIONS.map((opt) => opt.value);
      assert.ok(values.includes('auto'));
      assert.ok(values.includes('uk-UA'));
      assert.ok(values.includes('ru-RU'));
      assert.ok(values.includes('en-US'));
    });
  });

  describe('isWebSpeechSupported & getSpeechRecognitionConstructor', () => {
    it('returns false when window does not have SpeechRecognition or webkitSpeechRecognition', () => {
      const win = window as unknown as Record<string, unknown>;
      const origSR = win.SpeechRecognition;
      const origWSR = win.webkitSpeechRecognition;
      delete win.SpeechRecognition;
      delete win.webkitSpeechRecognition;

      try {
        assert.equal(isWebSpeechSupported(), false);
        assert.equal(getSpeechRecognitionConstructor(), null);
      } finally {
        if (origSR) win.SpeechRecognition = origSR;
        if (origWSR) win.webkitSpeechRecognition = origWSR;
      }
    });

    it('detects standard window.SpeechRecognition', () => {
      class MockSR extends EventTarget implements Partial<SpeechRecognitionInstance> {
        continuous = false;
        interimResults = false;
        lang = '';
        maxAlternatives = 1;
        onstart = null;
        onend = null;
        onerror = null;
        onresult = null;
        onspeechstart = null;
        onspeechend = null;
        onaudiostart = null;
        onaudioend = null;
        onnomatch = null;
        start = vi.fn();
        stop = vi.fn();
        abort = vi.fn();
      }

      const win = window as unknown as Record<string, unknown>;
      const origSR = win.SpeechRecognition;
      win.SpeechRecognition = MockSR as unknown as typeof win.SpeechRecognition;

      try {
        assert.equal(isWebSpeechSupported(), true);
        assert.equal(getSpeechRecognitionConstructor(), MockSR as unknown);
      } finally {
        if (origSR) win.SpeechRecognition = origSR;
        else delete win.SpeechRecognition;
      }
    });

    it('detects vendor-prefixed window.webkitSpeechRecognition', () => {
      class MockWebkitSR extends EventTarget implements Partial<SpeechRecognitionInstance> {
        continuous = false;
        interimResults = false;
        lang = '';
        maxAlternatives = 1;
        onstart = null;
        onend = null;
        onerror = null;
        onresult = null;
        onspeechstart = null;
        onspeechend = null;
        onaudiostart = null;
        onaudioend = null;
        onnomatch = null;
        start = vi.fn();
        stop = vi.fn();
        abort = vi.fn();
      }

      const win = window as unknown as Record<string, unknown>;
      const origSR = win.SpeechRecognition;
      const origWSR = win.webkitSpeechRecognition;
      delete win.SpeechRecognition;
      win.webkitSpeechRecognition = MockWebkitSR as unknown as typeof win.webkitSpeechRecognition;

      try {
        assert.equal(isWebSpeechSupported(), true);
        assert.equal(getSpeechRecognitionConstructor(), MockWebkitSR as unknown);
      } finally {
        if (origSR) win.SpeechRecognition = origSR;
        if (origWSR) win.webkitSpeechRecognition = origWSR;
        else delete win.webkitSpeechRecognition;
      }
    });
  });
});
