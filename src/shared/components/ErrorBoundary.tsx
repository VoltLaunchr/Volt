import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AlertTriangle, Check } from 'lucide-react';
import { logger } from '../utils/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  showDetails: boolean;
  copied: boolean;
}

/**
 * Catches any React render error in its subtree and:
 *  1. Shows the Tauri window (it may still be hidden if the crash happened
 *     before the happy-path win.show() useEffect ran).
 *  2. Renders a visible, actionable error UI instead of a blank/transparent screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    componentStack: null,
    showDetails: false,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
    // The window may still be hidden (visible: false in tauri.conf.json) if
    // the crash happened before the happy-path win.show() useEffect fired.
    void getCurrentWindow()
      .show()
      .catch(() => {});
  }

  private handleCopyError = (): void => {
    const { error, componentStack } = this.state;
    const parts: string[] = [];
    if (error?.message) parts.push(`Error: ${error.message}`);
    if (error?.stack) parts.push(error.stack);
    if (componentStack) parts.push(`\nComponent Stack:${componentStack}`);

    void navigator.clipboard.writeText(parts.join('\n')).then(() => {
      this.setState({ copied: true });
      window.setTimeout(() => {
        this.setState({ copied: false });
      }, 2000);
    });
  };

  private handleToggleDetails = (): void => {
    this.setState((s) => ({ showDetails: !s.showDetails }));
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, componentStack, showDetails, copied } = this.state;
    const hasDetails = Boolean(error?.stack ?? componentStack);

    return (
      <div style={styles.root}>
        <div style={styles.card}>
          <div style={styles.iconRow}>
            <AlertTriangle style={styles.icon} aria-hidden="true" size={36} />
          </div>

          <h1 style={styles.title}>Something went wrong</h1>

          <p style={styles.message}>{error?.message ?? 'An unexpected error occurred.'}</p>

          <div style={styles.actions}>
            <button
              style={styles.btnPrimary}
              onClick={() => {
                window.location.reload();
              }}
            >
              Reload
            </button>
            <button style={styles.btnSecondary} onClick={this.handleCopyError}>
              {copied && <Check size={13} style={{ marginRight: 5, verticalAlign: -2 }} />}
              {copied ? 'Copied' : 'Copy error'}
            </button>
          </div>

          {hasDetails && (
            <div style={styles.detailsWrapper}>
              <button style={styles.detailsToggle} onClick={this.handleToggleDetails}>
                {showDetails ? '▾ Hide details' : '▸ Show details'}
              </button>
              {showDetails && (
                <pre style={styles.detailsPre}>
                  {[
                    error?.stack ?? error?.message,
                    componentStack ? `\nComponent Stack:${componentStack}` : '',
                  ]
                    .filter(Boolean)
                    .join('')}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }
}

// ─── Styles ──────────────────────────────────────────────────────────────────
// Fully self-contained inline styles so this component works even when the
// main stylesheet (global.css / Tailwind) failed to load.

const styles: Record<string, CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#0e0e1a',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    padding: '24px',
    boxSizing: 'border-box',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    maxWidth: '480px',
    textAlign: 'center',
  },
  iconRow: {
    marginBottom: '4px',
  },
  icon: {
    fontSize: '36px',
    color: '#f59e0b',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
    color: '#f0f0f0',
  },
  message: {
    margin: 0,
    fontSize: '13px',
    color: '#888',
    lineHeight: 1.6,
    maxWidth: '380px',
    wordBreak: 'break-word',
  },
  actions: {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
  },
  btnPrimary: {
    padding: '7px 18px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#fff',
    background: '#3b3b6b',
    border: '1px solid #5050a0',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  btnSecondary: {
    padding: '7px 18px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#ccc',
    background: '#1e1e30',
    border: '1px solid #3a3a5a',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  detailsWrapper: {
    width: '100%',
    textAlign: 'left',
    marginTop: '4px',
  },
  detailsToggle: {
    width: '100%',
    padding: '6px 12px',
    fontSize: '12px',
    color: '#888',
    background: '#151520',
    border: '1px solid #2a2a3a',
    borderRadius: '6px',
    cursor: 'pointer',
    textAlign: 'left',
  },
  detailsPre: {
    marginTop: '8px',
    padding: '12px',
    background: '#0a0a12',
    border: '1px solid #252535',
    borderRadius: '6px',
    fontSize: '11px',
    color: '#777',
    overflow: 'auto',
    maxHeight: '220px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    textAlign: 'left',
  },
};
