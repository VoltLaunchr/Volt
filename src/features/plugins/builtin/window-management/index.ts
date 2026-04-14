import { Plugin, PluginContext, PluginResult, PluginResultType } from '../../types';
import { logger } from '../../../../shared/utils/logger';

// Window position commands with their trigger keywords and aliases
const WINDOW_COMMANDS = [
  {
    id: 'left_half',
    localeKey: 'leftHalf',
    triggers: ['left half', 'left', 'snap left'],
    icon: '◧',
  },
  {
    id: 'right_half',
    localeKey: 'rightHalf',
    triggers: ['right half', 'right', 'snap right'],
    icon: '◨',
  },
  {
    id: 'top_half',
    localeKey: 'topHalf',
    triggers: ['top half', 'top', 'snap top'],
    icon: '⬒',
  },
  {
    id: 'bottom_half',
    localeKey: 'bottomHalf',
    triggers: ['bottom half', 'bottom', 'snap bottom'],
    icon: '⬓',
  },
  {
    id: 'top_left',
    localeKey: 'topLeft',
    triggers: ['top left', 'top left quarter'],
    icon: '◰',
  },
  {
    id: 'top_right',
    localeKey: 'topRight',
    triggers: ['top right', 'top right quarter'],
    icon: '◳',
  },
  {
    id: 'bottom_left',
    localeKey: 'bottomLeft',
    triggers: ['bottom left', 'bottom left quarter'],
    icon: '◱',
  },
  {
    id: 'bottom_right',
    localeKey: 'bottomRight',
    triggers: ['bottom right', 'bottom right quarter'],
    icon: '◲',
  },
  {
    id: 'maximize',
    localeKey: 'maximize',
    triggers: ['maximize', 'max'],
    icon: '⬜',
  },
  {
    id: 'minimize',
    localeKey: 'minimize',
    triggers: ['minimize', 'min'],
    icon: '▁',
  },
  {
    id: 'center',
    localeKey: 'center',
    triggers: ['center', 'centre'],
    icon: '⊡',
  },
  {
    id: 'fullscreen',
    localeKey: 'fullscreen',
    triggers: ['fullscreen', 'full screen', 'toggle fullscreen'],
    icon: '⛶',
  },
  {
    id: 'restore',
    localeKey: 'restore',
    triggers: ['restore', 'unmaximize'],
    icon: '❐',
  },
];

// Keywords that activate this plugin when the query starts with them
const PLUGIN_KEYWORDS = [
  'window',
  'snap',
  'resize',
  'tile',
  'half',
  'quarter',
  'maximize',
  'minimize',
  'fenêtre',
  'left',
  'right',
  'top',
  'bottom',
  'center',
  'centre',
  'fullscreen',
  'restore',
];

export class WindowManagementPlugin implements Plugin {
  id = 'window-management';
  name = 'Window Management';
  description = 'Snap, resize, and move windows using keyboard commands';
  enabled = true;

  /**
   * Check if query can be handled by window management
   */
  canHandle(context: PluginContext): boolean {
    const query = context.query.trim().toLowerCase();
    if (!query) return false;

    // Check if query matches any plugin keyword
    if (PLUGIN_KEYWORDS.some((kw) => kw.startsWith(query) || query.startsWith(kw))) {
      return true;
    }

    // Check if query matches any command trigger
    return WINDOW_COMMANDS.some((cmd) =>
      cmd.triggers.some((trigger) => trigger.startsWith(query) || query.startsWith(trigger))
    );
  }

  /**
   * Match window management commands
   */
  match(context: PluginContext): PluginResult[] | null {
    const query = context.query.trim().toLowerCase();
    const results: PluginResult[] = [];

    // If the query is just a plugin keyword, show all commands
    const isKeywordOnly = PLUGIN_KEYWORDS.some((kw) => kw === query);

    for (const cmd of WINDOW_COMMANDS) {
      let score = 0;

      if (isKeywordOnly) {
        // Show all commands when just typing a keyword like "window" or "snap"
        score = 70;
      } else {
        // Check exact trigger match
        if (cmd.triggers.some((t) => t === query)) {
          score = 100;
        } else if (cmd.triggers.some((t) => t.startsWith(query))) {
          score = 85;
        } else if (cmd.triggers.some((t) => query.startsWith(t))) {
          score = 90;
        } else if (cmd.triggers.some((t) => t.includes(query) || query.includes(t))) {
          score = 75;
        }
      }

      if (score > 0) {
        results.push({
          id: `winmgmt-${cmd.id}`,
          type: PluginResultType.SystemCommand,
          title: `${cmd.icon}  ${cmd.localeKey.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}`,
          subtitle: cmd.triggers[0],
          badge: 'Window',
          score,
          data: {
            action: 'snap_window',
            position: cmd.id,
          },
        });
      }
    }

    return results.length > 0 ? results : null;
  }

  /**
   * Execute the window management command.
   * Hides Volt first, then invokes the backend snap command.
   */
  async execute(result: PluginResult): Promise<void> {
    const position = result.data?.position as string;
    if (!position) {
      logger.error('No position specified for window management command');
      return;
    }

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // Hide Volt first so the foreground window is the user's target
      await invoke('hide_window');

      // Snap the (now-foreground) window
      await invoke('snap_window', { position });
    } catch (error) {
      logger.error('Failed to snap window:', error);
    }
  }
}
