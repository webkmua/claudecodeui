import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  calculateRms,
  calculateFrequencyEnergy,
  evaluateVadFrame,
  DEFAULT_VAD_CONFIG,
  type VadState,
} from '@/modules/chat/utils/voiceActivityDetector';

describe('voiceActivityDetector', () => {
  describe('calculateRms', () => {
    it('returns 0 for empty buffer', () => {
      assert.equal(calculateRms(new Uint8Array(0)), 0);
    });

    it('returns 0 for pure silence (all 128s)', () => {
      const silence = new Uint8Array([128, 128, 128, 128]);
      assert.equal(calculateRms(silence), 0);
    });

    it('returns 1.0 for maximum square wave amplitude (0 and 255)', () => {
      const maxWave = new Uint8Array([0, 255, 0, 255]);
      // (128/128)^2 = 1, (127/128)^2 ~ 0.984 -> rms close to 1
      const rms = calculateRms(maxWave);
      assert.ok(rms > 0.98 && rms <= 1.0);
    });

    it('calculates expected small RMS for low-level noise', () => {
      const lowNoise = new Uint8Array([127, 129, 128, 127]);
      const rms = calculateRms(lowNoise);
      assert.ok(rms > 0 && rms < 0.01);
    });
  });

  describe('calculateFrequencyEnergy', () => {
    it('returns 0 for empty buffer', () => {
      assert.equal(calculateFrequencyEnergy(new Uint8Array(0)), 0);
    });

    it('returns exact average for frequency bins', () => {
      const bins = new Uint8Array([10, 20, 30, 40]);
      assert.equal(calculateFrequencyEnergy(bins), 25);
    });
  });

  describe('evaluateVadFrame', () => {
    const config = {
      silenceTimeoutMs: 1500,
      minSpeechDurationMs: 300,
      maxDurationMs: 60000,
      speechThreshold: 0.02,
    };

    const createInitialState = (t0 = 1000): VadState => ({
      hasSpoken: false,
      firstSpeechTime: 0,
      lastSpeechTime: 0,
      startTime: t0,
    });

    it('stays waiting during initial silence without committing', () => {
      const s0 = createInitialState(1000);
      const res = evaluateVadFrame(s0, false, 2500, config);
      assert.equal(res.shouldCommit, false);
      assert.equal(res.nextState.hasSpoken, false);
    });

    it('marks speech when active audio frame is received', () => {
      const s0 = createInitialState(1000);
      const res = evaluateVadFrame(s0, true, 2000, config);
      assert.equal(res.shouldCommit, false);
      assert.equal(res.nextState.hasSpoken, true);
      assert.equal(res.nextState.firstSpeechTime, 2000);
      assert.equal(res.nextState.lastSpeechTime, 2000);
    });

    it('does not commit on brief click or transient noise under minSpeechDurationMs', () => {
      const s0 = createInitialState(1000);
      // Brief pop at 2000ms (duration 50ms)
      const s1 = evaluateVadFrame(s0, true, 2000, config).nextState;
      const s2 = evaluateVadFrame(s1, true, 2050, config).nextState;
      // Followed by silence at 2500ms
      const res = evaluateVadFrame(s2, false, 2500, config);
      assert.equal(res.shouldCommit, false);
    });

    it('commits after genuine speech followed by silenceTimeoutMs', () => {
      const s0 = createInitialState(1000);
      // User speaks from 2000ms to 3000ms (1000ms speech > 300ms minSpeech)
      const s1 = evaluateVadFrame(s0, true, 2000, config).nextState;
      const s2 = evaluateVadFrame(s1, true, 3000, config).nextState;

      // Silence at 3500ms (500ms silence < 1500ms timeout)
      const res1 = evaluateVadFrame(s2, false, 3500, config);
      assert.equal(res1.shouldCommit, false);

      // Silence at 4400ms (1400ms silence < 1500ms timeout)
      const res2 = evaluateVadFrame(s2, false, 4400, config);
      assert.equal(res2.shouldCommit, false);

      // Silence at 4500ms (1500ms silence == silenceTimeoutMs)
      const res3 = evaluateVadFrame(s2, false, 4500, config);
      assert.equal(res3.shouldCommit, true);
      assert.equal(res3.reason, 'silence');
    });

    it('resets silence timer if user speaks again before silenceTimeoutMs', () => {
      const s0 = createInitialState(1000);
      // Speech 2000..3000ms
      const s1 = evaluateVadFrame(s0, true, 2000, config).nextState;
      const s2 = evaluateVadFrame(s1, true, 3000, config).nextState;

      // Brief pause at 3800ms (800ms silence)
      const resPause = evaluateVadFrame(s2, false, 3800, config);
      assert.equal(resPause.shouldCommit, false);

      // User resumes speaking at 3900ms
      const s3 = evaluateVadFrame(resPause.nextState, true, 3900, config).nextState;
      assert.equal(s3.lastSpeechTime, 3900);

      // Silence starts again at 4000ms
      const resAfterResume = evaluateVadFrame(s3, false, 5000, config);
      // 5000 - 3900 = 1100ms < 1500ms -> should NOT commit yet
      assert.equal(resAfterResume.shouldCommit, false);

      // At 5400ms (1500ms since last speech) -> commits!
      const resCommit = evaluateVadFrame(s3, false, 5400, config);
      assert.equal(resCommit.shouldCommit, true);
      assert.equal(resCommit.reason, 'silence');
    });

    it('commits when max duration is reached', () => {
      const s0 = createInitialState(1000);
      // 61 seconds later
      const res = evaluateVadFrame(s0, true, 62000, config);
      assert.equal(res.shouldCommit, true);
      assert.equal(res.reason, 'max_duration');
    });
  });
});
