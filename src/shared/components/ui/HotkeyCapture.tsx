import { useEffect, useRef, useState } from 'react';
import './HotkeyCapture.css';

export interface HotkeyCaptureProps {
  value: string;
  onChange: (hotkey: string) => void;
  onError?: (error: string) => void;
  disabled?: boolean;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export function HotkeyCapture({
  value,
  onChange,
  onError,
  disabled,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: HotkeyCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());
  // Mirror of pressedKeys so handleKeyUp can read current keys without
  // running side effects inside a setState updater (which StrictMode /
  // concurrent rendering may invoke twice).
  const pressedKeysRef = useRef<Set<string>>(new Set());

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

      const keys = new Set(pressedKeysRef.current);

      // Add modifiers
      if (e.ctrlKey) keys.add('Ctrl');
      if (e.altKey) keys.add('Alt');
      if (e.shiftKey) keys.add('Shift');
      if (e.metaKey) keys.add('Super');

      // Add main key (not a modifier)
      const key = e.key.toLowerCase();
      if (!['control', 'alt', 'shift', 'meta'].includes(key)) {
        const normalizedKey = normalizeKey(key);
        keys.add(normalizedKey);
      }

      pressedKeysRef.current = keys;
      setPressedKeys(keys);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keys = pressedKeysRef.current;
      if (keys.size === 0) return;

      const hotkey = buildHotkeyString(keys);
      pressedKeysRef.current = new Set();
      setPressedKeys(new Set());

      if (validateHotkey(hotkey)) {
        onChange(hotkey);
        setIsRecording(false);
      } else {
        onError?.('Invalid hotkey combination. Please use at least one modifier key.');
      }
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
    pressedKeysRef.current = new Set();
    setPressedKeys(new Set());
  };

  const handleCancelRecording = () => {
    setIsRecording(false);
    pressedKeysRef.current = new Set();
    setPressedKeys(new Set());
  };

  return (
    <div className="hotkey-capture" aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy}>
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
