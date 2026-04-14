import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../utils/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('[ErrorBoundary] Uncaught error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#1a1a2e',
          color: '#e0e0e0',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          gap: '16px',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <h1 style={{ fontSize: '20px', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
        <p style={{ fontSize: '14px', color: '#999', margin: 0 }}>
          An unexpected error occurred. Please reload to continue.
        </p>
        <button
          onClick={() => window.location.reload()}
          style={{
            marginTop: '8px',
            padding: '8px 20px',
            fontSize: '14px',
            fontWeight: 500,
            color: '#fff',
            background: '#3a3a5c',
            border: '1px solid #4a4a6a',
            borderRadius: '6px',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
