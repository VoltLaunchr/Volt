import i18n from 'i18next';
import enSystemCommands from './locales/en.json';
import frSystemCommands from './locales/fr.json';
i18n.addResourceBundle('en', 'systemcommands', enSystemCommands);
i18n.addResourceBundle('fr', 'systemcommands', frSystemCommands);

import { logger } from '../../../../shared/utils/logger';
import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';

export class SystemCommandsPlugin implements Plugin {
  id = 'systemcommands';
  name = 'System Commands';
  description = 'Execute system commands like reload, settings, quit';
  enabled = true;

  private commands = [
    {
      trigger: 'about',
      aliases: ['info', 'version'],
      title: 'About',
      subtitle: 'Volt information',
      action: 'about',
    },
    {
      trigger: 'account',
      aliases: ['user', 'profile'],
      title: 'Account',
      subtitle: 'User Settings',
      action: 'account',
    },
    {
      trigger: 'reload',
      aliases: ['refresh', 'restart'],
      title: 'Reload Volt',
      subtitle: 'Restart the application',
      action: 'reload',
    },
    {
      trigger: 'settings',
      aliases: ['preferences', 'config', 'options'],
      title: 'Open Settings',
      subtitle: 'Configure Volt preferences',
      action: 'settings',
    },
    {
      trigger: 'quit',
      aliases: ['exit', 'close'],
      title: 'Quit Volt',
      subtitle: 'Close the application',
      action: 'quit',
    },
  ];

  /**
   * Check if query matches a system command
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim().toLowerCase();

    if (!query) return false;

    return this.commands.some(
      (cmd) => cmd.trigger.startsWith(query) || cmd.aliases.some((alias) => alias.startsWith(query))
    );
  }

  /**
   * Match system commands
   */
  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim().toLowerCase();
    const results: PluginResult[] = [];

    for (const cmd of this.commands) {
      // Calculate match score
      let score = 0;

      if (cmd.trigger === query) {
        score = 100;
      } else if (cmd.trigger.startsWith(query)) {
        score = 85;
      } else if (cmd.aliases.some((a) => a === query)) {
        score = 95;
      } else if (cmd.aliases.some((a) => a.startsWith(query))) {
        score = 80;
      }

      if (score > 0) {
        results.push({
          id: `syscmd-${cmd.action}`,
          type: PluginResultType.SystemCommand,
          title: cmd.title,
          subtitle: cmd.subtitle,
          score: score,
          data: {
            action: cmd.action,
          },
        });
      }
    }

    return results.length > 0 ? results : null;
  }

  /**
   * Execute the system command
   */
  async execute(result: PluginResult): Promise<void> {
    const action = result.data?.action;

    switch (action) {
      case 'about':
        await this.openWebsite();
        break;
      case 'account':
        await this.openSettings();
        break;
      case 'reload':
        await this.reloadApp();
        break;
      case 'settings':
        await this.openSettings();
        break;
      case 'quit':
        await this.quitApp();
        break;
      default:
        console.warn(`Unknown system command: ${action}`);
    }
  }

  private async reloadApp(): Promise<void> {
    try {
      // Reload the frontend window
      window.location.reload();
    } catch (error) {
      logger.error('Failed to reload app:', error);
    }
  }

  private async openWebsite(): Promise<void> {
    try {
      // Open Volt website using Tauri opener plugin
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl('https://voltlaunchr.com');
    } catch (error) {
      logger.error('Failed to open website:', error);
      // Fallback: open in default browser
      window.open('https://voltlaunchr.com', '_blank');
    }
  }

  private async openSettings(): Promise<void> {
    // Trigger settings modal via custom event
    window.dispatchEvent(new CustomEvent('volt:open-settings'));
  }

  private async quitApp(): Promise<void> {
    try {
      // Use Tauri invoke command to quit
      const { invoke } = await import('@tauri-apps/api/core');
      // Hide window first, then the user can manually close or we rely on the app lifecycle
      await invoke('hide_window');
      // Note: Full app exit would require a Tauri command. For now, hiding is sufficient.
      console.log('App hidden. To fully quit, close from system tray if available.');
    } catch (error) {
      logger.error('Failed to quit app:', error);
      window.close();
    }
  }
}
