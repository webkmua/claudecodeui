/**
 * Web Speech API abstractions and capability detection for real-time speech recognition.
 * Supports cross-browser SpeechRecognition and webkitSpeechRecognition with
 * continuous listening and live interim results.
 */

export type SpeechRecognitionAlternativeLike = {
  readonly transcript: string;
  readonly confidence: number;
};

export type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternativeLike;
  [index: number]: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionResultListLike = {
  readonly length: number;
  item(index: number): SpeechRecognitionResultLike;
  [index: number]: SpeechRecognitionResultLike;
};

export type SpeechRecognitionEventLike = {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
} & Event;

export type SpeechRecognitionErrorEventLike = {
  readonly error: string;
  readonly message?: string;
} & Event;

export type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEventLike) => void) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEventLike) => void) | null;
  onspeechstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onspeechend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onaudiostart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onaudioend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onnomatch: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
} & EventTarget;

export type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

/**
 * Checks if the Web Speech API (standard or webkit-prefixed) is available in the current environment.
 */
export function isWebSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return Boolean(win.SpeechRecognition || win.webkitSpeechRecognition);
}

/**
 * Returns the SpeechRecognition constructor if available, or null.
 */
export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export type VoiceLanguageOption = {
  value: string;
  label: string;
  nativeName: string;
};

export const VOICE_LANGUAGE_OPTIONS: VoiceLanguageOption[] = [
  { value: 'auto', label: 'Auto (Browser)', nativeName: 'Auto (Browser)' },
  { value: 'uk-UA', label: 'Ukrainian', nativeName: 'Українська' },
  { value: 'ru-RU', label: 'Russian', nativeName: 'Русский' },
  { value: 'en-US', label: 'English (US)', nativeName: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)', nativeName: 'English (UK)' },
  { value: 'de-DE', label: 'German', nativeName: 'Deutsch' },
  { value: 'fr-FR', label: 'French', nativeName: 'Français' },
  { value: 'es-ES', label: 'Spanish', nativeName: 'Español' },
  { value: 'pl-PL', label: 'Polish', nativeName: 'Polski' },
  { value: 'it-IT', label: 'Italian', nativeName: 'Italiano' },
  { value: 'tr-TR', label: 'Turkish', nativeName: 'Türkçe' },
  { value: 'zh-CN', label: 'Chinese', nativeName: '中文' },
  { value: 'ja-JP', label: 'Japanese', nativeName: '日本語' },
];

const LANGUAGE_TAG_MAP: Record<string, string> = {
  uk: 'uk-UA',
  'uk-ua': 'uk-UA',
  'uk-UA': 'uk-UA',
  ru: 'ru-RU',
  'ru-ru': 'ru-RU',
  'ru-RU': 'ru-RU',
  en: 'en-US',
  'en-us': 'en-US',
  'en-US': 'en-US',
  'en-gb': 'en-GB',
  'en-GB': 'en-GB',
  es: 'es-ES',
  'es-es': 'es-ES',
  'es-ES': 'es-ES',
  de: 'de-DE',
  'de-de': 'de-DE',
  'de-DE': 'de-DE',
  fr: 'fr-FR',
  'fr-fr': 'fr-FR',
  'fr-FR': 'fr-FR',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
  'ja-JP': 'ja-JP',
  ko: 'ko-KR',
  'ko-kr': 'ko-KR',
  'ko-KR': 'ko-KR',
  'zh-cn': 'zh-CN',
  'zh-CN': 'zh-CN',
  zh: 'zh-CN',
  tr: 'tr-TR',
  'tr-tr': 'tr-TR',
  'tr-TR': 'tr-TR',
  it: 'it-IT',
  'it-it': 'it-IT',
  'it-IT': 'it-IT',
  id: 'id-ID',
  'id-id': 'id-ID',
  'id-ID': 'id-ID',
  cs: 'cs-CZ',
  'cs-cz': 'cs-CZ',
  'cs-CZ': 'cs-CZ',
  pt: 'pt-BR',
  'pt-br': 'pt-BR',
  'pt-BR': 'pt-BR',
  he: 'he-IL',
  'he-il': 'he-IL',
  'he-IL': 'he-IL',
  pl: 'pl-PL',
  'pl-pl': 'pl-PL',
  'pl-PL': 'pl-PL',
};

function normalizeLanguageTag(rawTag: string): string | null {
  const trimmed = rawTag.trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto') return null;
  if (LANGUAGE_TAG_MAP[trimmed]) return LANGUAGE_TAG_MAP[trimmed];
  const lower = trimmed.toLowerCase();
  if (LANGUAGE_TAG_MAP[lower]) return LANGUAGE_TAG_MAP[lower];
  if (trimmed.includes('-')) return trimmed;
  const prefix = lower.split('-')[0];
  if (LANGUAGE_TAG_MAP[prefix]) return LANGUAGE_TAG_MAP[prefix];
  return trimmed;
}

/**
 * Resolves an i18n locale or user preference to a full BCP-47 language tag suitable for Web Speech API.
 * Prioritizes preferredLang when set and not 'auto'.
 * When 'auto' or unsupplied, inspects navigator.languages / navigator.language before falling back.
 */
export function resolveRecognitionLanguage(preferredLang?: string): string {
  if (preferredLang) {
    const normalized = normalizeLanguageTag(preferredLang);
    if (normalized) return normalized;
  }

  if (typeof navigator !== 'undefined') {
    const navLangs: string[] = [];
    if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
      navLangs.push(...navigator.languages);
    } else if (navigator.language) {
      navLangs.push(navigator.language);
    }

    for (const raw of navLangs) {
      if (typeof raw === 'string') {
        const normalized = normalizeLanguageTag(raw);
        if (normalized) return normalized;
      }
    }
  }

  if (typeof document !== 'undefined' && document.documentElement?.lang) {
    const normalized = normalizeLanguageTag(document.documentElement.lang);
    if (normalized) return normalized;
  }

  return 'uk-UA';
}

/**
 * Concatenates two text strings with a single space separator if both are non-empty.
 */
export function appendWithSpace(a: string, b: string): string {
  const sA = a.trim();
  const sB = b.trim();
  if (!sA) return sB;
  if (!sB) return sA;
  return `${sA} ${sB}`;
}
