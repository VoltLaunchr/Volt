import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  Calculator,
  Clipboard as ClipboardIcon,
  Clock,
  Gamepad2,
  Globe,
  LayoutGrid,
  Link as LinkIcon,
  Package,
  Scissors,
  Smile,
  StickyNote,
  Terminal,
  Wrench,
} from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Switch } from '@/shared/components/ui/switch';
import { MANAGED_PLUGINS } from '../../plugins/builtin/manifest';
import { SettingsBody, SettingsPageHeader } from '../components/SettingsChrome';
import { SettingsRow, SettingsSection } from '../components/SettingsPrimitives';
import { settingsPageForPlugin, type SettingsCategory } from '../constants/settingsCategories';

// Lucide icon per managed plugin id. Keyed by the canonical runtime id from the MANAGED_PLUGINS
// manifest so the Settings list, the registry, and the default settings all agree on one id set.
const PLUGIN_ICONS: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  calculator: Calculator,
  websearch: Globe,
  systemcommands: Terminal,
  timer: Clock,
  system_monitor: Activity,
  games: Gamepad2,
  clipboard: ClipboardIcon,
  'emoji-picker': Smile,
  notes: StickyNote,
  snippets: Scissors,
  shellcommand: Terminal,
  quicklinks: LinkIcon,
  'window-management': LayoutGrid,
  'developer-tools': Wrench,
};

interface PluginsPageProps {
  enabledPlugins: readonly string[];
  onToggle: (pluginId: string, enabled: boolean) => void;
  onOpenPage: (page: SettingsCategory) => void;
}

/** Every built-in tool with its activation switch; the list comes from `MANAGED_PLUGINS`. */
export function PluginsPage({ enabledPlugins, onToggle, onOpenPage }: PluginsPageProps) {
  const { t } = useTranslation('settings');
  return (
    <div className="settings-page">
      <SettingsPageHeader category="plugins" />
      <SettingsBody>
        <SettingsSection sectionId="plugins.builtin" showDescription>
          {MANAGED_PLUGINS.map((plugin) => {
            const Icon = PLUGIN_ICONS[plugin.id] ?? Package;
            const page = settingsPageForPlugin(plugin.id);
            const name = t(plugin.nameKey);
            return (
              <SettingsRow
                key={plugin.id}
                rowId={`plugins.builtin.${plugin.id}`}
                icon={<Icon size={18} />}
              >
                {({ labelId }) => (
                  <div className="flex items-center gap-2">
                    <kbd className="settings-kbd">{plugin.hint}</kbd>
                    {page && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={t('plugins.configureLabel', { name })}
                        onClick={() => onOpenPage(page)}
                      >
                        {t('plugins.configure')}
                      </Button>
                    )}
                    <Switch
                      id={`plugin-${plugin.id}`}
                      aria-labelledby={labelId}
                      checked={enabledPlugins.includes(plugin.id)}
                      onCheckedChange={(checked) => onToggle(plugin.id, checked)}
                    />
                  </div>
                )}
              </SettingsRow>
            );
          })}
        </SettingsSection>
      </SettingsBody>
    </div>
  );
}
