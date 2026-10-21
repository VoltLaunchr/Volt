import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { Keycap } from './Keycap';

interface ShortcutEntry {
  keys: string[];
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutEntry[];
}

function getShortcutGroups(t: (key: string) => string): ShortcutGroup[] {
  return [
    {
      title: t('groups.navigation.title'),
      shortcuts: [
        { keys: ['↑', '↓'], description: t('groups.navigation.moveResults') },
        { keys: ['Home'], description: t('groups.navigation.jumpFirst') },
        { keys: ['End'], description: t('groups.navigation.jumpLast') },
        { keys: ['PgUp', 'PgDn'], description: t('groups.navigation.moveFive') },
      ],
    },
    {
      title: t('groups.actions.title'),
      shortcuts: [
        { keys: ['Enter'], description: t('groups.actions.launch') },
        { keys: ['Tab'], description: t('groups.actions.autocomplete') },
        { keys: ['Shift+Enter'], description: t('groups.actions.launchAdmin') },
        { keys: ['Ctrl+Enter'], description: t('groups.actions.launchKeepOpen') },
        { keys: ['Alt+1–9'], description: t('groups.actions.quickLaunch') },
      ],
    },
    {
      title: t('groups.fileApp.title'),
      shortcuts: [
        { keys: ['Ctrl+O'], description: t('groups.fileApp.openFolder') },
        { keys: ['Ctrl+C'], description: t('groups.fileApp.copyPath') },
        { keys: ['Ctrl+I'], description: t('groups.fileApp.showProperties') },
        { keys: ['Ctrl+Delete'], description: t('groups.fileApp.removeHistory') },
      ],
    },
    {
      title: t('groups.application.title'),
      shortcuts: [
        { keys: ['Esc'], description: t('groups.application.clearClose') },
        { keys: ['Ctrl+K'], description: t('groups.application.clearInput') },
        { keys: ['Ctrl+,'], description: t('groups.application.openSettings') },
        { keys: ['Ctrl+R'], description: t('groups.application.reload') },
        { keys: ['Ctrl+Q'], description: t('groups.application.quit') },
        { keys: ['F1'], description: t('groups.application.showHelp') },
      ],
    },
  ];
}

export interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps): React.JSX.Element {
  const { t } = useTranslation('help');
  const shortcutGroups = getShortcutGroups(t);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('title')} size="medium">
      <div className="flex flex-col gap-6">
        {shortcutGroups.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-accent-blue uppercase tracking-wide m-0">
              {group.title}
            </h3>
            <ul className="list-none p-0 m-0 flex flex-col gap-0.5" role="list">
              {group.shortcuts.map((entry) => (
                <li
                  key={entry.description}
                  className="flex items-center justify-between gap-4 px-2 py-1.5 rounded-sm transition-colors hover:bg-surface-elevated"
                >
                  <div
                    className="flex items-center gap-1 shrink-0 min-w-[140px]"
                    aria-label={entry.keys.join(', ')}
                  >
                    {entry.keys.map((key, i) => (
                      <React.Fragment key={key}>
                        <Keycap>{key}</Keycap>
                        {i < entry.keys.length - 1 && (
                          <span className="text-mute text-xs mx-px" aria-hidden="true">
                            /
                          </span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <span className="text-sm text-body text-right flex-1">{entry.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-xs text-mute text-center pt-2 border-t border-hairline m-0">
          {t('closeHint', { key: 'Esc' })}
        </p>
      </div>
    </Modal>
  );
}
