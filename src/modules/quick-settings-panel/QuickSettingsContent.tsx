import {
  AudioWaveform,
  Brain,
  Eye,
  Languages,
  Mic,
  Moon,
  Radio,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { DarkModeToggle } from '@/shared/ui';
import { LanguageSelector } from '@/modules/i18n';
import { SETTING_ROW_CLASS } from '@/shared/constants';
import type { PreferenceToggleKey, QuickSettingsPreferences } from '@/shared/types';
import QuickSettingsSection from '@/modules/quick-settings-panel/QuickSettingsSection';
import QuickSettingsToggleRow from '@/modules/quick-settings-panel/QuickSettingsToggleRow';
import { isWebSpeechSupported, VOICE_LANGUAGE_OPTIONS } from '@/shared/webSpeechRecognition';

/** Declarative description of one quick settings toggle row - its preference key, translation key and icon - so the rows can be rendered from a list instead of hand-written. */
type PreferenceToggleItem = {
  key: PreferenceToggleKey;
  labelKey: string;
  icon: LucideIcon;
};

const TOOL_DISPLAY_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'showRawParameters',
    labelKey: 'quickSettings.showRawParameters',
    icon: Eye,
  },
  {
    key: 'showThinking',
    labelKey: 'quickSettings.showThinking',
    icon: Brain,
  },
];

const INPUT_SETTING_TOGGLES: PreferenceToggleItem[] = [
  {
    key: 'sendByCtrlEnter',
    labelKey: 'quickSettings.sendByCtrlEnter',
    icon: Languages,
  },
  {
    key: 'voiceEnabled',
    labelKey: 'quickSettings.voiceEnabled',
    icon: Mic,
  },
  {
    key: 'voiceVadEnabled',
    labelKey: 'quickSettings.voiceVadEnabled',
    icon: AudioWaveform,
  },
  {
    key: 'voiceWebSpeechStreaming',
    labelKey: 'quickSettings.voiceWebSpeechStreaming',
    icon: Radio,
  },
];

type QuickSettingsContentProps = {
  isDarkMode: boolean;
  preferences: QuickSettingsPreferences;
  voiceLanguage?: string;
  onPreferenceChange: (key: PreferenceToggleKey, value: boolean) => void;
  onVoiceLanguageChange?: (value: string) => void;
};

/** Rendered by QuickSettingsPanelView to show the drawer's appearance, tool display and input preference rows. */
export default function QuickSettingsContent({
  isDarkMode,
  preferences,
  voiceLanguage,
  onPreferenceChange,
  onVoiceLanguageChange,
}: QuickSettingsContentProps) {
  const { t } = useTranslation('settings');
  const webSpeechSupported = isWebSpeechSupported();
  const inputSettingToggles = INPUT_SETTING_TOGGLES.filter(({ key }) => {
    if (key === 'voiceEnabled') return true;
    if (key === 'voiceVadEnabled') return preferences.voiceEnabled;
    if (key === 'voiceWebSpeechStreaming') return preferences.voiceEnabled && webSpeechSupported;
    return true;
  });

  const renderToggleRows = (items: PreferenceToggleItem[]) => (
    items.map(({ key, labelKey, icon }) => (
      <QuickSettingsToggleRow
        key={key}
        label={t(labelKey)}
        icon={icon}
        checked={preferences[key]}
        onCheckedChange={(value) => onPreferenceChange(key, value)}
      />
    ))
  );

  return (
    <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden bg-background p-4">
      <QuickSettingsSection title={t('quickSettings.sections.appearance')}>
        <div className={SETTING_ROW_CLASS}>
          <span className="flex items-center gap-2 text-sm text-foreground">
            {isDarkMode ? (
              <Moon className="h-4 w-4 text-muted-foreground" />
            ) : (
              <Sun className="h-4 w-4 text-muted-foreground" />
            )}
            {t('quickSettings.darkMode')}
          </span>
          <DarkModeToggle />
        </div>
        <LanguageSelector compact />
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.toolDisplay')}>
        {renderToggleRows(TOOL_DISPLAY_TOGGLES)}
      </QuickSettingsSection>

      <QuickSettingsSection title={t('quickSettings.sections.inputSettings')}>
        {renderToggleRows(inputSettingToggles)}
        {preferences.voiceEnabled && (
          <div className="flex items-center justify-between rounded-lg border border-transparent bg-muted/50 p-3 transition-colors hover:border-border hover:bg-accent">
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Languages className="h-4 w-4 text-muted-foreground" />
              {t('quickSettings.voiceLanguage', { defaultValue: 'Voice language' })}
            </span>
            <select
              value={voiceLanguage || 'auto'}
              onChange={(e) => onVoiceLanguageChange?.(e.target.value)}
              className="w-auto min-w-[120px] max-w-[160px] rounded-lg border border-input bg-card p-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label={t('quickSettings.voiceLanguage', { defaultValue: 'Voice language' })}
            >
              {VOICE_LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === 'auto'
                    ? t('voiceSettings.languageAuto', { defaultValue: 'Auto (Browser)' })
                    : opt.nativeName}
                </option>
              ))}
            </select>
          </div>
        )}
        <p className="ml-3 text-xs text-muted-foreground">
          {t('quickSettings.sendByCtrlEnterDescription')}
        </p>
      </QuickSettingsSection>
    </div>
  );
}
