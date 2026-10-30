import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeVoice } from '@/shared/api';
import type { VoiceInputState } from '@/shared/types';
import { VoiceActivityDetector } from '@/modules/chat/utils/voiceActivityDetector';
import {
  appendWithSpace,
  getSpeechRecognitionConstructor,
  isWebSpeechSupported,
  resolveRecognitionLanguage,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionInstance,
} from '@/shared/webSpeechRecognition';

// Mobile-safe recording: iOS Safari 18.4+ supports webm/opus; older iOS needs mp4.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function pickMime(): string {
  for (const t of MIME_CANDIDATES) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* isTypeSupported can throw on some iOS versions */
    }
  }
  return '';
}

export type UseVoiceInputOptions = {
  /** Enables client-side Voice Activity Detection to auto-commit on silence */
  vadEnabled?: boolean;
  /** Silence duration in ms before auto-committing. Default: 1500 */
  silenceTimeoutMs?: number;
  /** Continuous listening: automatically starts listening for the next phrase after transcription finishes. */
  continuous?: boolean;
  /** Uses browser Web Speech API for real-time live streaming dictation instead of server STT */
  webSpeechStreaming?: boolean;
  /** Preferred language tag for recognition (e.g. 'uk-UA', 'en-US') */
  lang?: string;
  /** Called when a recording/speech session begins so callers can snapshot the base input text */
  onStart?: () => void;
  /** Called when a recording/speech session ends cleanly */
  onEnd?: () => void;
};

/**
 * Dictation hook. Supports both manual push-to-talk and client-side Voice Activity
 * Detection (VAD) with silence auto-commit. Can operate in either server mode
 * (records audio, uploads to /api/voice/transcribe) or real-time Web Speech API mode
 * (streaming live interim and final results straight into the chat input).
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean, isInterim?: boolean) => void,
  onError?: (msg: string) => void,
  options?: UseVoiceInputOptions,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<VoiceActivityDetector | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const webSpeechActiveRef = useRef(false);
  const webSpeechRunningRef = useRef(false);
  const sessionTextRef = useRef('');
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const startingRef = useRef(false);
  const manuallyStoppedRef = useRef(false);
  // Whether the in-progress stop should auto-send the transcript (vs just fill the box).
  const sendRef = useRef(false);

  const cleanupVad = () => {
    vadRef.current?.destroy();
    vadRef.current = null;
    setIsSpeaking(false);
  };

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  };

  const stopTracks = () => {
    cleanupVad();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop recognition/mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      startingRef.current = false;
      clearSilenceTimer();
      cleanupVad();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          /* noop */
        }
        recognitionRef.current = null;
      }
      webSpeechActiveRef.current = false;
      webSpeechRunningRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const scheduleSilenceTimer = useCallback(() => {
    clearSilenceTimer();
    if (!options?.vadEnabled) return;
    const timeoutMs = options.silenceTimeoutMs ?? 1500;
    silenceTimerRef.current = setTimeout(() => {
      setIsSpeaking(false);
      const rec = recognitionRef.current;
      if (rec && webSpeechRunningRef.current) {
        try {
          rec.stop();
        } catch {
          try {
            rec.abort();
          } catch {
            /* noop */
          }
        }
      }
    }, timeoutMs);
  }, [options?.vadEnabled, options?.silenceTimeoutMs]);

  const stop = useCallback((opts?: { send?: boolean; manual?: boolean }) => {
    clearSilenceTimer();
    cleanupVad();
    if (opts?.manual !== false) {
      manuallyStoppedRef.current = true;
    }

    if (webSpeechActiveRef.current) {
      sendRef.current = opts?.send ?? false;
      const rec = recognitionRef.current;
      if (rec && webSpeechRunningRef.current) {
        if (opts?.send) {
          setState('transcribing');
        }
        try {
          rec.stop();
        } catch {
          try {
            rec.abort();
          } catch {
            /* noop */
          }
        }
      } else if (opts?.manual !== false) {
        webSpeechActiveRef.current = false;
        setState('idle');
        options?.onEnd?.();
      }
      return;
    }

    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      sendRef.current = opts?.send ?? false;
      rec.stop();
    } else if (opts?.manual !== false) {
      setState('idle');
      options?.onEnd?.();
    }
  }, [options]);

  const startWebSpeech = useCallback(() => {
    const SpeechConstructor = getSpeechRecognitionConstructor();
    if (!SpeechConstructor) {
      onError?.('Web Speech API is not supported in this browser.');
      setState('idle');
      return;
    }

    webSpeechActiveRef.current = true;
    webSpeechRunningRef.current = false;
    sessionTextRef.current = '';
    options?.onStart?.();

    const rec = new SpeechConstructor();
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.lang = resolveRecognitionLanguage(options?.lang);

    rec.onstart = () => {
      if (cancelledRef.current) {
        try {
          rec.abort();
        } catch {
          /* noop */
        }
        return;
      }
      webSpeechRunningRef.current = true;
      setState('recording');
    };

    rec.onspeechstart = () => {
      if (cancelledRef.current) return;
      setIsSpeaking(true);
      clearSilenceTimer();
    };

    rec.onspeechend = () => {
      if (cancelledRef.current) return;
      setIsSpeaking(false);
      if (options?.vadEnabled) {
        scheduleSilenceTimer();
      }
    };

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      if (cancelledRef.current) return;
      let finalChunk = '';
      let interimChunk = '';

      for (let i = 0; i < event.results.length; ++i) {
        const res = event.results[i];
        const phrase = res[0]?.transcript || '';
        if (res.isFinal) {
          finalChunk = appendWithSpace(finalChunk, phrase);
        } else {
          interimChunk = appendWithSpace(interimChunk, phrase);
        }
      }

      const currentText = appendWithSpace(finalChunk, interimChunk);
      sessionTextRef.current = currentText;

      if (currentText) {
        const isInterim = Boolean(interimChunk);
        if (isInterim) {
          setIsSpeaking(true);
          clearSilenceTimer();
        } else {
          setIsSpeaking(false);
          if (options?.vadEnabled) {
            scheduleSilenceTimer();
          }
        }
        onTranscript(currentText, false, isInterim);
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEventLike) => {
      if (cancelledRef.current) return;
      clearSilenceTimer();
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        return;
      }
      let msg = `Speech recognition error: ${event.error}`;
      if (event.error === 'not-allowed') msg = 'Microphone access denied.';
      else if (event.error === 'audio-capture') msg = 'No microphone found.';
      else if (event.error === 'network') msg = 'Web Speech network error.';
      onError?.(msg);
    };

    rec.onend = () => {
      webSpeechRunningRef.current = false;
      clearSilenceTimer();
      if (cancelledRef.current) return;

      const shouldSend = sendRef.current;
      sendRef.current = false;

      if (sessionTextRef.current) {
        onTranscript(sessionTextRef.current, shouldSend, false);
      }

      options?.onEnd?.();

      if (options?.continuous && !shouldSend && !manuallyStoppedRef.current) {
        options?.onStart?.();
        sessionTextRef.current = '';
        try {
          rec.start();
        } catch {
          webSpeechActiveRef.current = false;
          setState('idle');
          setIsSpeaking(false);
        }
      } else {
        webSpeechActiveRef.current = false;
        setState('idle');
        setIsSpeaking(false);
      }
    };

    try {
      rec.start();
    } catch (err) {
      webSpeechActiveRef.current = false;
      webSpeechRunningRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(`Could not start speech recognition: ${msg}`);
      setState('idle');
    }
  }, [
    onTranscript,
    onError,
    options,
    scheduleSilenceTimer,
  ]);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    if (webSpeechActiveRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;

    startingRef.current = true;
    manuallyStoppedRef.current = false;

    if (options?.webSpeechStreaming && isWebSpeechSupported()) {
      try {
        startWebSpeech();
      } finally {
        startingRef.current = false;
      }
      return;
    }

    options?.onStart?.();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelledRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const mimeType = pickMime();
      const rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = rec;
      chunksRef.current = [];

      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      rec.onstop = async () => {
        stopTracks();
        if (cancelledRef.current) return;
        const shouldSend = sendRef.current;
        sendRef.current = false;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 800) {
          setState('idle');
          options?.onEnd?.();
          onError?.('Recording too short');
          return;
        }
        setState('transcribing');
        try {
          const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
          const res = await transcribeVoice(blob, `recording.${ext}`);
          if (!res.ok) throw new Error(`transcribe ${res.status}`);
          const data = await res.json();
          if (cancelledRef.current) return;
          const text = String(data?.text || '').trim();
          if (text) onTranscript(text, shouldSend, false);
          else onError?.('No speech detected');
        } catch (e) {
          if (!cancelledRef.current) {
            onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } finally {
          if (!cancelledRef.current) {
            options?.onEnd?.();
            if (options?.continuous && !shouldSend && !manuallyStoppedRef.current) {
              void start();
            } else {
              setState('idle');
            }
          }
        }
      };

      rec.start();
      setState('recording');

      if (options?.vadEnabled) {
        vadRef.current = new VoiceActivityDetector(stream, {
          silenceTimeoutMs: options.silenceTimeoutMs,
          onSilence: () => {
            stop({ send: false, manual: false });
          },
          onSpeechStart: () => {
            setIsSpeaking(true);
          },
          onSpeechEnd: () => {
            setIsSpeaking(false);
          },
        });
      }
    } catch (e) {
      recorderRef.current = null;
      stopTracks();
      if (cancelledRef.current) return;
      options?.onEnd?.();
      const err = e as { name?: string; message?: string };
      let msg = `Mic error: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = 'Microphone access denied.';
      else if (err?.name === 'NotFoundError') msg = 'No microphone found.';
      onError?.(msg);
      setState('idle');
    } finally {
      startingRef.current = false;
    }
  }, [
    onTranscript,
    onError,
    options,
    startWebSpeech,
    stop,
  ]);

  const toggle = useCallback(() => {
    if (state === 'recording') {
      stop({ manual: true });
    } else if (state === 'transcribing') {
      manuallyStoppedRef.current = true;
      if (webSpeechActiveRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          /* noop */
        }
        webSpeechActiveRef.current = false;
      }
      setState('idle');
    } else if (state === 'idle') {
      void start();
    }
  }, [state, start, stop]);

  return { state, toggle, stop, isSpeaking };
}
