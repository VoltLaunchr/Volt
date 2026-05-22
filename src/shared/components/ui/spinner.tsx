export interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  message?: string;
}

const sizeMap = { small: 16, medium: 20, large: 24 };

export function Spinner({ size = 'medium', message }: SpinnerProps) {
  const px = sizeMap[size];
  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <svg
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin text-mute"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeOpacity="0.2"
        />
        <path
          d="M12 2a10 10 0 0 1 10 10"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {message && <p className="text-xs text-mute">{message}</p>}
    </div>
  );
}
