import React from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import './HelpDialog.css';

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
        { keys: ['F1', '?'], description: t('groups.application.showHelp') },
      ],
    },
  ];
}

export interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpDialog: React.FC<HelpDialogProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation('help');
  const shortcutGroups = getShortcutGroups(t);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('title')} size="medium">
      <div className="help-dialog-content">
        {shortcutGroups.map((group) => (
          <section key={group.title} className="help-group">
            <h3 className="help-group-title">{group.title}</h3>
            <ul className="help-shortcut-list" role="list">
              {group.shortcuts.map((entry) => (
                <li key={entry.description} className="help-shortcut-item">
                  <div className="help-shortcut-keys" aria-label={entry.keys.join(', ')}>
                    {entry.keys.map((key, i) => (
                      <React.Fragment key={key}>
                        <kbd className="help-key">{key}</kbd>
                        {i < entry.keys.length - 1 && (
                          <span className="help-key-separator" aria-hidden="true">
                            /
                          </span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  <span className="help-shortcut-desc">{entry.description}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="help-dialog-footer">
          {t('closeHint', { key: 'Esc' })}
        </p>
      </div>
    </Modal>
  );
};
