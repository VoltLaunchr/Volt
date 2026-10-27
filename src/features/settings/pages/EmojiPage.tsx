import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider } from '@/shared/components/ui/slider';
import { Button } from '@/shared/components/ui/button';
import {
  SettingsBody,
  SettingsPageHeader,
  SettingsSelect,
  SettingsStatus,
} from '../components/SettingsChrome';
import {
  SettingsGate,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection,
  type SettingsPluginState,
} from '../components/SettingsPrimitives';
import {
  getEmojiColumns,
  getEmojiPrimaryAction,
  setEmojiColumns,
  setEmojiPrimaryAction,
} from '../../plugins/builtin/emoji-picker/utils/emojiSettings';
import { clearHistory as clearEmojiHistory } from '../../plugins/builtin/emoji-picker/utils/history';
import {
  getPreferredSkinTone,
  setPreferredSkinTone,
} from '../../plugins/builtin/emoji-picker/utils/skinTones';
import type { SkinTone } from '../../plugins/builtin/emoji-picker/types';

const SKIN_TONES: SkinTone[] = ['none', 'light', 'medium-light', 'medium', 'medium-dark', 'dark'];

const SKIN_TONE_SAMPLE: Record<SkinTone, string> = {
  none: '✋',
  light: '✋🏻',
  'medium-light': '✋🏼',
  medium: '✋🏽',
  'medium-dark': '✋🏾',
  dark: '✋🏿',
};

/** Emoji picker preferences. They live in the browser storage shared with the launcher window. */
export function EmojiPage({ pluginState }: { pluginState: SettingsPluginState }) {
  const { t } = useTranslation('settings');
  const [skinTone, setSkinTone] = useState<SkinTone>(() => getPreferredSkinTone());
  const [columns, setColumns] = useState<number>(() => getEmojiColumns());
  const [primaryAction, setPrimaryAction] = useState<'copy' | 'paste'>(() =>
    getEmojiPrimaryAction()
  );
  const [cleared, setCleared] = useState(false);

  return (
    <div className="settings-page">
      <SettingsPageHeader category="emoji" />
      <SettingsBody>
        <SettingsPluginSection page="emoji" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="emoji.preferences">
            <SettingsRow rowId="emoji.preferences.primaryAction" htmlFor="emoji-primary-action">
              <SettingsSelect
                id="emoji-primary-action"
                label={t('emoji.primaryAction')}
                value={primaryAction}
                onValueChange={(action) => {
                  setPrimaryAction(action);
                  setEmojiPrimaryAction(action);
                }}
                options={[
                  { value: 'copy', label: t('emoji.copy') },
                  { value: 'paste', label: t('emoji.paste') },
                ]}
              />
            </SettingsRow>
            <SettingsRow
              rowId="emoji.preferences.columns"
              description={t('emoji.columnsDesc', { count: columns })}
            >
              {({ labelId }) => (
                <div className="flex items-center gap-2">
                  <Slider
                    value={[columns]}
                    min={4}
                    max={12}
                    step={1}
                    aria-labelledby={labelId}
                    className="w-36 min-w-24 data-horizontal:w-36"
                    onValueChange={(next) => {
                      const value = typeof next === 'number' ? next : next[0];
                      setColumns(value);
                      setEmojiColumns(value);
                    }}
                  />
                  <span className="w-5 text-right text-[13px] tabular-nums text-muted-foreground">
                    {columns}
                  </span>
                </div>
              )}
            </SettingsRow>
            <SettingsRow rowId="emoji.preferences.skinTone" stacked>
              <div className="settings-choice-grid grid-cols-3 sm:grid-cols-6">
                {SKIN_TONES.map((tone) => (
                  <button
                    type="button"
                    key={tone}
                    className="settings-choice"
                    title={t(`emoji.tones.${tone}`)}
                    aria-pressed={skinTone === tone}
                    onClick={() => {
                      setSkinTone(tone);
                      setPreferredSkinTone(tone);
                    }}
                  >
                    <span className="text-2xl leading-none">{SKIN_TONE_SAMPLE[tone]}</span>
                    <span className="text-center text-[10px]">{t(`emoji.tones.${tone}`)}</span>
                  </button>
                ))}
              </div>
            </SettingsRow>
          </SettingsSection>
          <SettingsSection sectionId="emoji.data">
            <SettingsRow rowId="emoji.data.clearRecent">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  clearEmojiHistory();
                  setCleared(true);
                }}
              >
                {t('emoji.clear')}
              </Button>
            </SettingsRow>
            {cleared && (
              <div className="p-2.5">
                <SettingsStatus kind="success">{t('emoji.cleared')}</SettingsStatus>
              </div>
            )}
          </SettingsSection>
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}
