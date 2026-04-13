import React from 'react';
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

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['↑', '↓'], description: 'Move between results' },
      { keys: ['Home'], description: 'Jump to first result' },
      { keys: ['End'], description: 'Jump to last result' },
      { keys: ['PgUp', 'PgDn'], description: 'Move 5 results at a time' },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['Enter'], description: 'Launch selected result' },
      { keys: ['Tab'], description: 'Autocomplete with selected title' },
      { keys: ['Shift+Enter'], description: 'Launch as administrator' },
      { keys: ['Ctrl+Enter'], description: 'Launch without closing Volt' },
      { keys: ['Alt+1–9'], description: 'Quick-launch result by number' },
    ],
  },
  {
    title: 'File & App Commands',
    shortcuts: [
      { keys: ['Ctrl+O'], description: 'Open containing folder' },
      { keys: ['Ctrl+C'], description: 'Copy path to clipboard' },
      { keys: ['Ctrl+I'], description: 'Show item properties' },
      { keys: ['Ctrl+Delete'], description: 'Remove from launch history' },
    ],
  },
  {
    title: 'Application',
    shortcuts: [
      { keys: ['Esc'], description: 'Clear search / close Volt' },
      { keys: ['Ctrl+K'], description: 'Clear search input' },
      { keys: ['Ctrl+,'], description: 'Open Settings' },
      { keys: ['Ctrl+R'], description: 'Reload Volt' },
      { keys: ['Ctrl+Q'], description: 'Quit / hide Volt' },
      { keys: ['F1', '?'], description: 'Show this help dialog' },
    ],
  },
];

export interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const HelpDialog: React.FC<HelpDialogProps> = ({ isOpen, onClose }) => {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Keyboard Shortcuts" size="medium">
      <div className="help-dialog-content">
        {SHORTCUT_GROUPS.map((group) => (
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
          Press <kbd className="help-key">Esc</kbd> to close
        </p>
      </div>
    </Modal>
  );
};
