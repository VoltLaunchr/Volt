import { useState } from 'react';
import { Input } from '@/shared/components/ui/input';
import { clampInt, type NumberRange } from '../behavior/pluginOptions';

/**
 * Integer input that keeps what the user types while editing and commits a value clamped into
 * `range` on blur / Enter, so an out-of-range or empty entry can never reach the settings.
 */
export function SettingsNumberField({
  value,
  range,
  unit,
  onCommit,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
}: {
  value: number;
  range: NumberRange;
  unit?: string;
  onCommit: (value: number) => void;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = draft.trim() === '' ? Number.NaN : Number(draft);
    const next = clampInt(parsed, range, value);
    setDraft(null);
    if (next !== value) onCommit(next);
  };

  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        inputMode="numeric"
        min={range.min}
        max={range.max}
        step={1}
        className="w-24"
        value={draft ?? String(value)}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
      />
      {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
    </div>
  );
}
