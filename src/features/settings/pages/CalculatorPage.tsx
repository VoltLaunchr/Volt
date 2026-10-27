import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/components/ui/button';
import { SettingsBody, SettingsPageHeader, SettingsStatus } from '../components/SettingsChrome';
import {
  SettingsGate,
  SettingsNote,
  SettingsPluginSection,
  SettingsRow,
  SettingsSection,
  type SettingsPluginState,
} from '../components/SettingsPrimitives';
import { clearHistory as clearCalculationHistory } from '../../plugins/builtin/calculator/utils/history';

/** Calculator: the only stored data is the local result history, cleared from here. */
export function CalculatorPage({ pluginState }: { pluginState: SettingsPluginState }) {
  const { t } = useTranslation('settings');
  const [cleared, setCleared] = useState(false);
  return (
    <div className="settings-page">
      <SettingsPageHeader category="calculator" />
      <SettingsBody>
        <SettingsPluginSection page="calculator" state={pluginState} />
        <SettingsGate enabled={pluginState.enabled}>
          <SettingsSection sectionId="calculator.history">
            <SettingsNote>{t('calculator.infoText')}</SettingsNote>
            <SettingsRow rowId="calculator.history.clear">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  clearCalculationHistory();
                  setCleared(true);
                }}
              >
                {t('calculator.clear')}
              </Button>
            </SettingsRow>
            {cleared && (
              <div className="p-2.5">
                <SettingsStatus kind="success">{t('calculator.cleared')}</SettingsStatus>
              </div>
            )}
          </SettingsSection>
        </SettingsGate>
      </SettingsBody>
    </div>
  );
}
