import { Plugin, PluginActivation, PluginContext, PluginResult, PluginResultType } from '../../types';
import { VOLT_EVENTS, emitVoltEvent } from '../../../../shared/events';

export class DeveloperCommandsPlugin implements Plugin {
  id = 'developer';
  name = 'Developer';
  description = 'Developer tools: create and manage extensions';
  enabled = true;

  // `mode: 'custom'` — canHandle does type-ahead matching against command
  // triggers/aliases; these keywords drive only the scoring boost.
  activation: PluginActivation = {
    mode: 'custom',
    keywords: ['developer', 'dev', 'extension', 'extensions', 'create', 'manage', 'scaffold'],
  };

  private commands = [
    {
      trigger: 'create',
      aliases: ['developer', 'dev', 'extension', 'scaffold', 'new extension', 'new ext'],
      title: 'Create Extension',
      subtitle: 'Developer',
      icon: '/icons/app/create_extension_icon.svg',
      action: 'create-extension',
    },
    {
      trigger: 'manage',
      aliases: ['developer', 'dev', 'extensions', 'ext store', 'extension store'],
      title: 'Manage Extensions',
      subtitle: 'Developer',
      icon: '/icons/app/manage_extensions_icon.svg',
      action: 'manage-extensions',
    },
  ];

  canHandle(context: PluginContext): boolean {
    const query = context.query.trim().toLowerCase();
    if (!query) return false;
    return this.commands.some(
      (cmd) =>
        cmd.trigger.startsWith(query) ||
        cmd.aliases.some((alias) => alias.startsWith(query))
    );
  }

  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim().toLowerCase();
    const results: PluginResult[] = [];

    for (const cmd of this.commands) {
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
          id: `dev-${cmd.action}`,
          type: PluginResultType.SystemCommand,
          title: cmd.title,
          subtitle: cmd.subtitle,
          icon: cmd.icon,
          score,
          data: { action: cmd.action },
        });
      }
    }

    return results.length > 0 ? results : null;
  }

  execute(result: PluginResult): void {
    const action = result.data?.action as string | undefined;

    switch (action) {
      case 'create-extension':
        emitVoltEvent(VOLT_EVENTS.OPEN_CREATE_EXTENSION);
        break;
      case 'manage-extensions':
        emitVoltEvent(VOLT_EVENTS.OPEN_MANAGE_EXTENSIONS);
        break;
      default:
        break;
    }
  }
}
