import { Switch } from '@base-ui/react/switch';
import { cn } from '@/lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ checked, onChange, label, disabled = false, id }: ToggleProps) {
  return (
    <div className={cn('flex items-center gap-2', disabled && 'opacity-50')}>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border border-hairline transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline-strong data-[checked]:bg-on-dark data-[unchecked]:bg-surface-elevated disabled:cursor-not-allowed"
      >
        <Switch.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-surface transition-transform data-[checked]:translate-x-[18px] data-[unchecked]:translate-x-0.5" />
      </Switch.Root>
      {label && (
        <label htmlFor={id} className="text-sm text-body cursor-pointer select-none">
          {label}
        </label>
      )}
    </div>
  );
}
