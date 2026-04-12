import './ErrorMessage.css';

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
    <div className={`error-message error-message-${variant}`} role="alert">
      <div className="error-message-icon">
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
      <div className="error-message-content">
        {title && <h4 className="error-message-title">{title}</h4>}
        <p className="error-message-text">{message}</p>
      </div>
      <div className="error-message-actions">
        {onRetry && (
          <button
            type="button"
            className="error-message-retry"
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
            className="error-message-dismiss"
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
