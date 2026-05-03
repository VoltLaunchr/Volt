import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Keycap } from './Keycap';

export interface HotkeyCaptureProps {
  value: string;
  onChange: (hotkey: string) => void;
  onError?: (error: string) => void;
  onRecordingChange?: (recording: boolean) => void;
  disabled?: boolean;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

export function HotkeyCapture({
  value,
  onChange,
  onError,
  onRecordingChange,
  disabled,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: HotkeyCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    onRecordingChange?.(isRecording);
  }, [isRecording, onRecordingChange]);
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
    <div className="inline-flex items-center gap-2" aria-labelledby={ariaLabelledBy} aria-describedby={ariaDescribedBy}>
      {isRecording ? (
        <div className="flex items-center gap-2 px-3 py-2 bg-accent-blue border-2 border-accent-blue rounded-md animate-pulse">
          <div className="flex items-center gap-1 min-w-[120px] text-white font-medium">
            {pressedKeys.size > 0 ? (
              Array.from(pressedKeys).map((key, index) => (
                <span key={key} className="flex items-center gap-1">
                  <kbd className="px-2 py-0.5 text-sm font-mono bg-white/20 border border-white/30 rounded-sm text-white font-bold">
                    {key}
                  </kbd>
                  {index < pressedKeys.size - 1 && (
                    <span className="text-white/80 text-xs">+</span>
                  )}
                </span>
              ))
            ) : (
              <span className="text-sm text-white/90 italic">Press your key combination...</span>
            )}
          </div>
          <button
            type="button"
            className="flex items-center justify-center w-6 h-6 p-0 bg-white/20 border-0 rounded-sm text-white cursor-pointer text-base font-bold transition-colors hover:bg-white/30 hover:scale-110"
            onClick={handleCancelRecording}
            aria-label="Cancel recording"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={cn(
            'flex items-center gap-2 px-3 py-2 bg-surface-elevated border border-hairline rounded-md cursor-pointer transition-colors',
            'hover:border-hairline-strong disabled:opacity-50 disabled:cursor-not-allowed',
            !value && 'border-dashed border-white/20 hover:border-accent-blue hover:bg-accent-blue/5'
          )}
          onClick={handleStartRecording}
          disabled={disabled}
        >
          {value ? (
            <>
              <Keycap>{value}</Keycap>
              <span className="text-sm opacity-60">✏️</span>
            </>
          ) : (
            <span className="text-xs text-ash">Record Hotkey</span>
          )}
        </button>
      )}
    </div>
  );
}
