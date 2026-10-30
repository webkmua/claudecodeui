import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeVoice } from '@/shared/api';
import type { VoiceInputState } from '@/shared/types';
import { VoiceActivityDetector } from '@/modules/chat/utils/voiceActivityDetector';

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
};

/**
 * Dictation hook. Supports both manual push-to-talk and client-side Voice Activity
 * Detection (VAD) with silence auto-commit. Records the mic, uploads to
 * /api/voice/transcribe, and returns the transcript through onTranscript.
 */
export function useVoiceInput(
  onTranscript: (text: string, send?: boolean) => void,
  onError?: (msg: string) => void,
  options?: UseVoiceInputOptions,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const [isSpeaking, setIsSpeaking] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const vadRef = useRef<VoiceActivityDetector | null>(null);
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

  const stopTracks = () => {
    cleanupVad();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Stop the mic if the component unmounts mid-recording.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      startingRef.current = false;
      cleanupVad();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      recorderRef.current = null;
    };
  }, []);

  const stop = useCallback((opts?: { send?: boolean; manual?: boolean }) => {
    cleanupVad();
    if (opts?.manual ?? true) {
      manuallyStoppedRef.current = true;
    }
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') {
      sendRef.current = opts?.send ?? false;
      rec.stop();
    }
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current || (recorderRef.current && recorderRef.current.state !== 'inactive')) return;
    startingRef.current = true;
    manuallyStoppedRef.current = false;
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
        // Capture and clear the send intent for this stop before any async work.
        const shouldSend = sendRef.current;
        sendRef.current = false;
        const type = rec.mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size < 800) {
          setState('idle');
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
          if (text) onTranscript(text, shouldSend);
          else onError?.('No speech detected');
        } catch (e) {
          if (!cancelledRef.current) {
            onError?.(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`);
          }
        } finally {
          if (!cancelledRef.current) {
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
      const err = e as { name?: string; message?: string };
      let msg = `Mic error: ${err?.message || e}`;
      if (err?.name === 'NotAllowedError') msg = 'Microphone access denied.';
      else if (err?.name === 'NotFoundError') msg = 'No microphone found.';
      onError?.(msg);
      setState('idle');
    } finally {
      startingRef.current = false;
    }
  }, [onTranscript, onError, options?.vadEnabled, options?.silenceTimeoutMs, options?.continuous, stop]);

  const toggle = useCallback(() => {
    if (state === 'recording') stop({ manual: true });
    else if (state === 'idle') start();
  }, [state, start, stop]);

  return { state, toggle, stop, isSpeaking };
}
