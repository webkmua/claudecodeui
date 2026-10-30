import type { InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import SettingsSection from '@/modules/settings/SettingsSection';
import SettingsToggle from '@/modules/settings/SettingsToggle';
import { useUiPreferences, useSetUiPreference } from '@/shared/context/UiPreferencesContext';
import { useVoiceConfig } from '@/modules/settings/hooks/useVoiceConfig';
import { isWebSpeechSupported, VOICE_LANGUAGE_OPTIONS } from '@/shared/webSpeechRecognition';

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <input className={inputClass} {...props} />
    </label>
  );
}

/** Rendered by Settings for the "voice" tab, covering speech-to-text provider credentials. */
export default function VoiceSettingsTab() {
  const { t } = useTranslation('settings');
  const preferences = useUiPreferences();
  const setPreference = useSetUiPreference();
  const { config, update } = useVoiceConfig();
  const voiceEnabled = preferences.voiceEnabled;
  const webSpeechSupported = isWebSpeechSupported();

  return (
    <div className="space-y-8">
      <SettingsSection title={t('voiceSettings.title')} description={t('voiceSettings.description')}>
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div className="pr-3">
              <div className="text-sm font-medium text-foreground">{t('voiceSettings.enable')}</div>
              <div className="text-xs text-muted-foreground">{t('voiceSettings.enableDescription')}</div>
            </div>
            <SettingsToggle
              checked={voiceEnabled}
              onChange={(v) => setPreference('voiceEnabled', v)}
              ariaLabel={t('voiceSettings.enable')}
            />
          </div>

          {voiceEnabled && (
            <>
              {webSpeechSupported && (
                <div className="flex items-center justify-between rounded-lg border border-border p-3">
                  <div className="pr-3">
                    <div className="text-sm font-medium text-foreground">
                      {t('voiceSettings.webSpeechStreaming', { defaultValue: 'Live browser streaming (Web Speech)' })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t('voiceSettings.webSpeechStreamingDescription', {
                        defaultValue: 'Stream speech into the input live in real time as you speak.',
                      })}
                    </div>
                  </div>
                  <SettingsToggle
                    checked={preferences.voiceWebSpeechStreaming}
                    onChange={(v) => setPreference('voiceWebSpeechStreaming', v)}
                    ariaLabel={t('voiceSettings.webSpeechStreaming', { defaultValue: 'Live browser streaming (Web Speech)' })}
                  />
                </div>
              )}

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="pr-3">
                  <div className="text-sm font-medium text-foreground">
                    {t('voiceSettings.language', { defaultValue: 'Recognition language' })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t('voiceSettings.languageDescription', {
                      defaultValue: 'Language expected for speech recognition (Web Speech).',
                    })}
                  </div>
                </div>
                <select
                  value={preferences.voiceLanguage || 'auto'}
                  onChange={(e) => setPreference('voiceLanguage', e.target.value)}
                  className="w-auto min-w-[140px] max-w-[200px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label={t('voiceSettings.language', { defaultValue: 'Recognition language' })}
                >
                  {VOICE_LANGUAGE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === 'auto'
                        ? t('voiceSettings.languageAuto', { defaultValue: 'Auto (Browser)' })
                        : `${opt.nativeName} (${opt.value})`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="pr-3">
                  <div className="text-sm font-medium text-foreground">{t('voiceSettings.vad', { defaultValue: 'Silence auto-commit (VAD)' })}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('voiceSettings.vadDescription', { defaultValue: 'Automatically stop recording and transcribe when you pause speaking.' })}
                  </div>
                </div>
                <SettingsToggle
                  checked={preferences.voiceVadEnabled}
                  onChange={(v) => setPreference('voiceVadEnabled', v)}
                  ariaLabel={t('voiceSettings.vad', { defaultValue: 'Silence auto-commit (VAD)' })}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="pr-3">
                  <div className="text-sm font-medium text-foreground">{t('voiceSettings.continuous', { defaultValue: 'Continuous dictation' })}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('voiceSettings.continuousDescription', { defaultValue: 'Keep listening for the next phrase after each transcription finishes.' })}
                  </div>
                </div>
                <SettingsToggle
                  checked={preferences.voiceContinuousMode}
                  onChange={(v) => setPreference('voiceContinuousMode', v)}
                  ariaLabel={t('voiceSettings.continuous', { defaultValue: 'Continuous dictation' })}
                />
              </div>
            </>
          )}
        </div>
      </SettingsSection>

      {voiceEnabled && (
        <SettingsSection title={t('voiceSettings.backendTitle')} description={t('voiceSettings.backendDescription')}>
          {preferences.voiceWebSpeechStreaming && (
            <div className="mb-4 rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
              {t('voiceSettings.streamingActiveNote', {
                defaultValue:
                  'Live Web Speech streaming is active. Audio is transcribed directly in your browser without uploading recordings to the server.',
              })}
            </div>
          )}
          <form className="space-y-4" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            {/* Fake inputs to trap Chrome aggressive credentials autofill */}
            <input
              type="text"
              name="fake_user_remembered"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
              autoComplete="username"
            />
            <input
              type="password"
              name="fake_password_remembered"
              tabIndex={-1}
              aria-hidden="true"
              style={{ position: 'absolute', opacity: 0, height: 0, width: 0, pointerEvents: 'none' }}
              autoComplete="current-password"
            />

            <Field
              label={t('voiceSettings.baseUrl')}
              type="url"
              name="voice_custom_base_url"
              autoComplete="off"
              data-form-type="other"
              data-lpignore="true"
              placeholder="https://api.openai.com/v1"
              value={config.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
            />
            <Field
              label={t('voiceSettings.apiKey')}
              type="password"
              name="voice_custom_api_key"
              autoComplete="new-password"
              data-form-type="other"
              data-lpignore="true"
              placeholder="sk-…"
              value={config.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <Field
                label={t('voiceSettings.sttModel')}
                name="voice_custom_stt_model"
                autoComplete="off"
                placeholder="whisper-1"
                value={config.sttModel}
                onChange={(e) => update({ sttModel: e.target.value })}
              />
              <Field
                label={t('voiceSettings.ttsModel')}
                name="voice_custom_tts_model"
                autoComplete="off"
                placeholder="tts-1"
                value={config.ttsModel}
                onChange={(e) => update({ ttsModel: e.target.value })}
              />
              <Field
                label={t('voiceSettings.voice')}
                name="voice_custom_tts_voice"
                autoComplete="off"
                placeholder="alloy"
                value={config.ttsVoice}
                onChange={(e) => update({ ttsVoice: e.target.value })}
              />
              <Field
                label={t('voiceSettings.format')}
                name="voice_custom_tts_format"
                autoComplete="off"
                placeholder="mp3"
                value={config.ttsFormat}
                onChange={(e) => update({ ttsFormat: e.target.value })}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
          </form>
        </SettingsSection>
      )}
    </div>
  );
}
