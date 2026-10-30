/**
 * Client-side Voice Activity Detection (VAD) and silence detection helpers.
 *
 * Uses the Web Audio API AnalyserNode to inspect incoming microphone frames for
 * speech energy (RMS of time-domain data + frequency energy), tracking when the
 * user speaks and detecting subsequent silence to trigger auto-commit without
 * needing manual "Stop" button presses.
 */

export type VadConfig = {
  /** Silence duration in ms before auto-committing. Default: 1500 */
  silenceTimeoutMs: number;
  /** Minimum speech duration in ms required before silence detection activates. Default: 250 */
  minSpeechDurationMs: number;
  /** Maximum recording duration in ms before forcing auto-commit. Default: 60000 */
  maxDurationMs: number;
  /** RMS amplitude threshold (0.0 to 1.0) above which audio is considered active speech. Default: 0.02 */
  speechThreshold: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  silenceTimeoutMs: 1500,
  minSpeechDurationMs: 250,
  maxDurationMs: 60000,
  speechThreshold: 0.02,
};

export type VadState = {
  hasSpoken: boolean;
  firstSpeechTime: number;
  lastSpeechTime: number;
  startTime: number;
};

export type VadFrameResult = {
  nextState: VadState;
  shouldCommit: boolean;
  reason?: 'silence' | 'max_duration';
};

/**
 * Calculates the Root-Mean-Square (RMS) amplitude from 8-bit unsigned PCM data [0..255].
 * Center/silence is 128; output is normalized to [0.0..1.0].
 */
export function calculateRms(timeDomainData: Uint8Array): number {
  if (timeDomainData.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    const normalized = (timeDomainData[i] - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / timeDomainData.length);
}

/**
 * Calculates the average frequency energy from byte frequency data [0..255].
 */
export function calculateFrequencyEnergy(freqData: Uint8Array): number {
  if (freqData.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) {
    sum += freqData[i];
  }
  return sum / freqData.length;
}

/**
 * Pure state machine transition evaluator for one audio analysis frame.
 */
export function evaluateVadFrame(
  state: VadState,
  isSpeechActive: boolean,
  now: number,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): VadFrameResult {
  // Hard cap on total duration to avoid runaway recordings
  if (now - state.startTime >= config.maxDurationMs) {
    return {
      nextState: state,
      shouldCommit: true,
      reason: 'max_duration',
    };
  }

  if (isSpeechActive) {
    const nextState: VadState = {
      ...state,
      hasSpoken: true,
      firstSpeechTime: state.firstSpeechTime === 0 ? now : state.firstSpeechTime,
      lastSpeechTime: now,
    };
    return {
      nextState,
      shouldCommit: false,
    };
  }

  // Not speaking in this frame:
  if (!state.hasSpoken) {
    // Hasn't started speaking yet: keep waiting
    return {
      nextState: state,
      shouldCommit: false,
    };
  }

  // User has spoken in the past. Check if speech met minimum duration:
  const speechDuration = state.lastSpeechTime - state.firstSpeechTime;
  if (speechDuration < config.minSpeechDurationMs) {
    // False positive / brief click: if silence has persisted for 2x minSpeechDuration, reset hasSpoken
    if (now - state.lastSpeechTime > config.minSpeechDurationMs * 2) {
      return {
        nextState: {
          ...state,
          hasSpoken: false,
          firstSpeechTime: 0,
          lastSpeechTime: 0,
        },
        shouldCommit: false,
      };
    }
    return {
      nextState: state,
      shouldCommit: false,
    };
  }

  // User spoke genuine words, now in silence window:
  const silenceDuration = now - state.lastSpeechTime;
  if (silenceDuration >= config.silenceTimeoutMs) {
    return {
      nextState: state,
      shouldCommit: true,
      reason: 'silence',
    };
  }

  return {
    nextState: state,
    shouldCommit: false,
  };
}

export type VoiceActivityDetectorOptions = {
  silenceTimeoutMs?: number;
  minSpeechDurationMs?: number;
  maxDurationMs?: number;
  speechThreshold?: number;
  onSilence: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: () => void;
};

/**
 * Real-time voice activity detector attached to a MediaStream.
 * Periodically polls the stream's audio levels and fires onSilence when speech ends.
 */
export class VoiceActivityDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state: VadState;
  private config: VadConfig;
  private timeDomainBuffer: Uint8Array<ArrayBuffer> | null = null;
  private freqBuffer: Uint8Array<ArrayBuffer> | null = null;
  private isDestroyed = false;
  private wasSpeaking = false;

  constructor(
    stream: MediaStream,
    private readonly options: VoiceActivityDetectorOptions,
  ) {
    this.config = {
      silenceTimeoutMs: options.silenceTimeoutMs ?? DEFAULT_VAD_CONFIG.silenceTimeoutMs,
      minSpeechDurationMs: options.minSpeechDurationMs ?? DEFAULT_VAD_CONFIG.minSpeechDurationMs,
      maxDurationMs: options.maxDurationMs ?? DEFAULT_VAD_CONFIG.maxDurationMs,
      speechThreshold: options.speechThreshold ?? DEFAULT_VAD_CONFIG.speechThreshold,
    };

    this.state = {
      hasSpoken: false,
      firstSpeechTime: 0,
      lastSpeechTime: 0,
      startTime: Date.now(),
    };

    this.init(stream);
  }

  private init(stream: MediaStream): void {
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      this.audioContext = new AudioCtx();
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.2;
      this.source.connect(this.analyser);

      this.timeDomainBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
      this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

      // Poll at ~16-20 Hz (60ms) to detect pauses promptly without burning CPU
      this.timer = setInterval(() => this.tick(), 60);
    } catch {
      // In case AudioContext creation fails, detector stays inert; push-to-talk still works
    }
  }

  private tick(): void {
    if (this.isDestroyed || !this.analyser || !this.timeDomainBuffer || !this.freqBuffer) return;

    this.analyser.getByteTimeDomainData(this.timeDomainBuffer);
    this.analyser.getByteFrequencyData(this.freqBuffer);

    const rms = calculateRms(this.timeDomainBuffer);
    const freqEnergy = calculateFrequencyEnergy(this.freqBuffer);

    const isSpeech = rms > this.config.speechThreshold || freqEnergy > 16;

    if (isSpeech && !this.wasSpeaking) {
      this.wasSpeaking = true;
      this.options.onSpeechStart?.();
    } else if (!isSpeech && this.wasSpeaking) {
      this.wasSpeaking = false;
      this.options.onSpeechEnd?.();
    }

    const { nextState, shouldCommit } = evaluateVadFrame(
      this.state,
      isSpeech,
      Date.now(),
      this.config,
    );

    this.state = nextState;

    if (shouldCommit) {
      this.destroy();
      this.options.onSilence();
    }
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* ignore */
      }
      this.source = null;
    }
    if (this.analyser) {
      try {
        this.analyser.disconnect();
      } catch {
        /* ignore */
      }
      this.analyser = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        void this.audioContext.close();
      } catch {
        /* ignore */
      }
      this.audioContext = null;
    }
  }
}
