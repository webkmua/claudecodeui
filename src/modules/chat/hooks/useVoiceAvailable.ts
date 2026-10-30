import { useEffect, useState } from 'react';

import { api } from '@/shared/api';
import { useUiPreferences } from '@/shared/context/UiPreferencesContext';
import { isValidCustomVoiceUrl, readVoiceConfig, VOICE_CONFIG_SYNC_EVENT } from '@/shared/voiceConfig';
import { isWebSpeechSupported } from '@/shared/webSpeechRecognition';

// Voice UI is gated on the `voiceEnabled` UI preference (toggled in Quick Settings /
// the Settings modal) and a configured voice backend or browser Web Speech API.
let healthRequest: Promise<boolean> | null = null;

function checkVoiceHealth(): Promise<boolean> {
  if (healthRequest) return healthRequest;
  const request = api.voice.health()
    .then(async (response) => {
      if (!response.ok) throw new Error(`Voice health check failed (${response.status})`);
      const data = await response.json();
      return data?.configured === true;
    })
    .finally(() => {
      healthRequest = null;
    });
  healthRequest = request;
  return request;
}

export function useVoiceAvailable(): boolean {
  // Read through the shared preferences owner. This used to re-parse the
  // preferences blob and register its own storage + sync listeners, once per
  // assistant message row.
  const { voiceEnabled: enabled, voiceWebSpeechStreaming } = useUiPreferences();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    let requestId = 0;

    const check = async () => {
      if (!enabled) {
        setAvailable(false);
        return;
      }
      // If Web Speech streaming is active and supported, voice input is available immediately.
      if (voiceWebSpeechStreaming && isWebSpeechSupported()) {
        setAvailable(true);
        return;
      }
      if (isValidCustomVoiceUrl(readVoiceConfig().baseUrl)) {
        setAvailable(true);
        return;
      }
      const id = ++requestId;
      try {
        const result = await checkVoiceHealth();
        if (active && id === requestId) setAvailable(result);
      } catch {
        // Fallback: if server check fails but Web Speech is supported, allow voice
        if (active && id === requestId) setAvailable(isWebSpeechSupported());
      }
    };

    void check();
    window.addEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    return () => {
      active = false;
      window.removeEventListener(VOICE_CONFIG_SYNC_EVENT, check);
    };
  }, [enabled, voiceWebSpeechStreaming]);

  return enabled && available;
}
