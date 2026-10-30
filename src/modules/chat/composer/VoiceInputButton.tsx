import { useTranslation } from 'react-i18next';
import { Mic, Square, Loader2 } from 'lucide-react';

import { PromptInputButton } from '@/modules/chat/composer/PromptInput';
import type { VoiceInputState } from '@/shared/types';

type Props = {
  state: VoiceInputState;
  onToggle: () => void;
  errorMsg?: string | null;
  isSpeaking?: boolean;
  vadEnabled?: boolean;
};

// Rendered by chat's ChatComposer next to the send button.
// Push-to-talk mic button (presentational). Recording state and the stop-and-send action
// are owned by the composer so the main Send button can drive them too. This button just
// starts recording and, while recording, stops and drops the transcript into the input box.
export default function VoiceInputButton({ state, onToggle, errorMsg, isSpeaking, vadEnabled }: Props) {
  const { t } = useTranslation('chat');

  const tooltipContent =
    state === 'recording'
      ? vadEnabled
        ? isSpeaking
          ? t('voice.vadListening', { defaultValue: 'Listening… (pause to finish)' })
          : t('voice.vadWaiting', { defaultValue: 'Listening… (auto-stops on silence)' })
        : t('voice.stopRecording')
      : state === 'transcribing'
        ? t('voice.transcribing', { defaultValue: 'Transcribing…' })
        : t('voice.input');

  const icon =
    state === 'recording' ? (
      <span className="relative flex items-center justify-center">
        <Square className="text-red-500" />
        {isSpeaking && (
          <span className="absolute -inset-1 animate-ping rounded-full bg-red-400/30 pointer-events-none" />
        )}
      </span>
    ) : state === 'transcribing' ? (
      <Loader2 className="animate-spin" />
    ) : (
      <Mic />
    );

  return (
    <span className="relative inline-flex">
      {errorMsg && (
        <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-red-600 px-2 py-1 text-xs text-white shadow-lg">
          {errorMsg}
        </span>
      )}
      <PromptInputButton
        tooltip={{ content: tooltipContent }}
        onClick={(e: { preventDefault: () => void }) => {
          e.preventDefault();
          onToggle();
        }}
        aria-label={tooltipContent}
      >
        {icon}
      </PromptInputButton>
    </span>
  );
}
