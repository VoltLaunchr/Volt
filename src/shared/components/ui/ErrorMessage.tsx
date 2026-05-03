import { cn } from '@/lib/utils';

export interface ErrorMessageProps {
  message: string;
  title?: string;
  variant?: 'inline' | 'toast' | 'banner';
  onDismiss?: () => void;
  onRetry?: () => void;
}

export function ErrorMessage({
  message,
  title,
  variant = 'inline',
  onDismiss,
  onRetry,
}: ErrorMessageProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 rounded-md bg-accent-red-soft border border-red-500/30 text-accent-red',
        variant === 'inline' && 'w-full',
        variant === 'toast' &&
          'fixed bottom-6 right-6 max-w-[400px] shadow-lg z-50 animate-[error-slide-in_0.2s_ease]',
        variant === 'banner' && 'rounded-none border-x-0'
      )}
      role="alert"
    >
      <div className="shrink-0 flex items-center justify-center text-accent-red">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        {title && (
          <h4 className="text-sm font-semibold mb-1 text-accent-red">{title}</h4>
        )}
        <p className="text-sm text-body leading-normal break-words m-0">{message}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onRetry && (
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-sm bg-transparent border-0 text-body cursor-pointer transition-colors hover:bg-white/10 hover:text-on-dark active:scale-95"
            onClick={onRetry}
            aria-label="Retry"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
        {onDismiss && (
          <button
            type="button"
            className="flex items-center justify-center w-7 h-7 rounded-sm bg-transparent border-0 text-body cursor-pointer transition-colors hover:bg-white/10 hover:text-on-dark active:scale-95"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
