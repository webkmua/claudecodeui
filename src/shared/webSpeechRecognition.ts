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

const LANGUAGE_TAG_MAP: Record<string, string> = {
  uk: 'uk-UA',
  en: 'en-US',
  es: 'es-ES',
  de: 'de-DE',
  fr: 'fr-FR',
  ja: 'ja-JP',
  ko: 'ko-KR',
  'zh-CN': 'zh-CN',
  zh: 'zh-CN',
  ru: 'ru-RU',
  tr: 'tr-TR',
  it: 'it-IT',
  id: 'id-ID',
  cs: 'cs-CZ',
  pt: 'pt-BR',
  'pt-BR': 'pt-BR',
  he: 'he-IL',
};

/**
 * Resolves an i18n locale or browser language to a full BCP-47 language tag suitable for Web Speech API.
 */
export function resolveRecognitionLanguage(preferredLang?: string): string {
  if (preferredLang && preferredLang.trim()) {
    const trimmed = preferredLang.trim();
    if (LANGUAGE_TAG_MAP[trimmed]) return LANGUAGE_TAG_MAP[trimmed];
    if (trimmed.includes('-')) return trimmed;
  }
  if (typeof document !== 'undefined' && document.documentElement?.lang) {
    const docLang = document.documentElement.lang.trim();
    if (LANGUAGE_TAG_MAP[docLang]) return LANGUAGE_TAG_MAP[docLang];
    if (docLang.includes('-')) return docLang;
  }
  if (typeof navigator !== 'undefined' && navigator.language) {
    return navigator.language;
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
