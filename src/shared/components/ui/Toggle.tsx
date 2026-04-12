import './Toggle.css';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}

export function Toggle({ checked, onChange, label, disabled = false, id }: ToggleProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.checked);
  };

  return (
    <div className={`toggle-wrapper ${disabled ? 'toggle-disabled' : ''}`}>
      <label className="toggle-container" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          className="toggle-input"
          checked={checked}
          onChange={handleChange}
          disabled={disabled}
        />
        <span className="toggle-slider"></span>
      </label>
      {label && <span className="toggle-label">{label}</span>}
    </div>
  );
}
