import { useEffect, useState } from 'react';
import './HotkeyCapture.css';

export interface HotkeyCaptureProps {
  value: string;
  onChange: (hotkey: string) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
}

export function HotkeyCapture({ value, onChange, onError, disabled }: HotkeyCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isRecording) return;

    // Helper functions inside useEffect to avoid dependency issues
    const normalizeKey = (key: string): string => {
      // Normalize special keys to Tauri format
      const keyMap: Record<string, string> = {
        ' ': 'Space',
        arrowup: 'Up',
        arrowdown: 'Down',
        arrowleft: 'Left',
        arrowright: 'Right',
        escape: 'Escape',
        enter: 'Return',
        backspace: 'Backspace',
        delete: 'Delete',
        tab: 'Tab',
      };

      const normalized = keyMap[key.toLowerCase()] || key.toUpperCase();
      return normalized;
    };

    const buildHotkeyString = (keys: Set<string>): string => {
      const modifiers: string[] = [];
      let mainKey = '';

      keys.forEach((key) => {
        if (['Ctrl', 'Alt', 'Shift', 'Super'].includes(key)) {
          modifiers.push(key.toLowerCase());
        } else {
          mainKey = key;
        }
      });

      // Sort modifiers for consistency
      modifiers.sort();

      return [...modifiers, mainKey].join('+');
    };

    const validateHotkey = (hotkey: string): boolean => {
      // Must have at least one modifier
      const hasModifier =
        hotkey.includes('ctrl') ||
        hotkey.includes('alt') ||
        hotkey.includes('shift') ||
        hotkey.includes('super');

      // Must have a main key
      const parts = hotkey.split('+');
      const hasMainKey = parts.length > 1;

      return hasModifier && hasMainKey;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setPressedKeys((prev) => {
        const keys = new Set(prev);

        // Add modifiers
        if (e.ctrlKey) keys.add('Ctrl');
        if (e.altKey) keys.add('Alt');
        if (e.shiftKey) keys.add('Shift');
        if (e.metaKey) keys.add('Super');

        // Add main key (not a modifier)
        const key = e.key.toLowerCase();
        if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
          // Normalize special keys
          const normalizedKey = normalizeKey(key);
          keys.add(normalizedKey);
        }

        return keys;
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      setPressedKeys((prev) => {
        if (prev.size > 0) {
          // Build hotkey string
          const hotkey = buildHotkeyString(prev);

          if (validateHotkey(hotkey)) {
            onChange(hotkey);
            setIsRecording(false);
            return new Set();
          } else {
            onError?.('Invalid hotkey combination. Please use at least one modifier key.');
            return new Set();
          }
        }
        return prev;
      });
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isRecording, onChange, onError]);

  const handleStartRecording = () => {
    if (disabled) return;
    setIsRecording(true);
    setPressedKeys(new Set());
  };

  const handleCancelRecording = () => {
    setIsRecording(false);
    setPressedKeys(new Set());
  };

  return (
    <div className="hotkey-capture">
      {isRecording ? (
        <div className="hotkey-recording">
          <div className="hotkey-recording-display">
            {pressedKeys.size > 0 ? (
              Array.from(pressedKeys).map((key, index) => (
                <kbd key={key}>
                  {key}
                  {index < pressedKeys.size - 1 && ' + '}
                </kbd>
              ))
            ) : (
              <span className="hotkey-prompt">Press your key combination...</span>
            )}
          </div>
          <button
            type="button"
            className="hotkey-cancel"
            onClick={handleCancelRecording}
            aria-label="Cancel recording"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`hotkey-button ${!value ? 'hotkey-button-empty' : ''}`}
          onClick={handleStartRecording}
          disabled={disabled}
        >
          {value ? (
            <>
              <kbd>{value}</kbd>
              <span className="hotkey-edit-icon">✏️</span>
            </>
          ) : (
            <span className="hotkey-placeholder">Record Hotkey</span>
          )}
        </button>
      )}
    </div>
  );
}
