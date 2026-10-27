import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/components/ui/button';
import { HotkeyCapture } from '@/shared/components/ui';
import { Switch } from '@/shared/components/ui/switch';
import { ESCAPE_BEHAVIOR_OPTIONS, LIST_NAVIGATION_OPTIONS } from '../behavior/keyboard';
import {
  SettingsBody,
  SettingsPageHeader,
  SettingsSelect,
  SettingsStatus,
} from '../components/SettingsChrome';
import { SettingsRow, SettingsSection } from '../components/SettingsPrimitives';
import type { KeyboardSettings } from '../types/settings.types';

interface KeyboardPageProps {
  keyboard: KeyboardSettings;
  onKeyboardChange: (patch: Partial<KeyboardSettings>) => void;
  /** Global shortcut that opens Settings; empty = none. */
  openSettingsHotkey: string;
  /** Registers the shortcut with the OS first; rejects with a message when it is refused. */
  onOpenSettingsHotkeyChange: (hotkey: string) => Promise<void>;
}

/** Escape, result navigation and the optional global shortcut for Settings. */
export function KeyboardPage({
  keyboard,
  onKeyboardChange,
  openSettingsHotkey,
  onOpenSettingsHotkeyChange,
}: KeyboardPageProps) {
  const { t } = useTranslation('settings');
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  const changeHotkey = async (hotkey: string) => {
    setHotkeyError(null);
    try {
      await onOpenSettingsHotkeyChange(hotkey);
    } catch (error) {
      setHotkeyError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="settings-page">
      <SettingsPageHeader category="keyboard" />
      <SettingsBody>
        <SettingsSection sectionId="keyboard.escape">
          <SettingsRow rowId="keyboard.escape.behavior">
            <SettingsSelect
              label={t('keyboard.escapeBehavior')}
              value={keyboard.escapeBehavior}
              options={ESCAPE_BEHAVIOR_OPTIONS.map((value) => ({
                value,
                label: t(`keyboard.escapeOptions.${value}`),
              }))}
              onValueChange={(escapeBehavior) => onKeyboardChange({ escapeBehavior })}
              className="sm:w-64"
            />
          </SettingsRow>
          <SettingsRow rowId="keyboard.escape.secondaryWindows">
            <Switch
              checked={keyboard.escapeClosesSecondaryWindows}
              onCheckedChange={(escapeClosesSecondaryWindows) =>
                onKeyboardChange({ escapeClosesSecondaryWindows })
              }
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection sectionId="keyboard.navigation">
          <SettingsRow rowId="keyboard.navigation.preset">
            <SettingsSelect
              label={t('keyboard.listNavigation')}
              value={keyboard.listNavigation}
              options={LIST_NAVIGATION_OPTIONS.map((value) => ({
                value,
                label: t(`keyboard.listNavigationOptions.${value}`),
              }))}
              onValueChange={(listNavigation) => onKeyboardChange({ listNavigation })}
              className="sm:w-64"
            />
          </SettingsRow>
        </SettingsSection>

        <SettingsSection sectionId="keyboard.global">
          <SettingsRow rowId="keyboard.global.openSettings">
            {({ labelId, descriptionId }) => (
              <div className="flex items-center gap-2">
                <HotkeyCapture
                  value={openSettingsHotkey}
                  onChange={(hotkey) => void changeHotkey(hotkey)}
                  onError={setHotkeyError}
                  aria-labelledby={labelId}
                  aria-describedby={descriptionId}
                />
                {openSettingsHotkey !== '' && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void changeHotkey('')}
                  >
                    {t('keyboard.clearHotkey')}
                  </Button>
                )}
              </div>
            )}
          </SettingsRow>
          {hotkeyError && <SettingsStatus kind="error">{hotkeyError}</SettingsStatus>}
        </SettingsSection>
      </SettingsBody>
    </div>
  );
}
