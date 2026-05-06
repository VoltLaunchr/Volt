import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initI18n } from './i18n';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

// ---------------------------------------------------------------------------
// Fatal error renderer
// ---------------------------------------------------------------------------
// Called when bootstrap() throws before any page is mounted, or when the
// startup watchdog fires. Must be self-contained (no external CSS, no i18n)
// and MUST show the window — it may still be hidden (visible:false in
// tauri.conf.json) if the crash happened before the React happy-path ran.

async function renderFatalError(error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  // Show the window first so the error UI is actually visible to the user.
  try {
    await getCurrentWindow().show();
  } catch { /* best-effort — ignore if the window API is unavailable */ }

  root.render(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#0e0e1a',
        color: '#e0e0e0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      <span style={{ fontSize: '32px', color: '#f59e0b' }} aria-hidden="true">⚠</span>
      <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0, color: '#f0f0f0' }}>
        Volt failed to start
      </h1>
      <p
        style={{
          fontSize: '13px',
          color: '#888',
          margin: 0,
          maxWidth: '400px',
          wordBreak: 'break-word',
          lineHeight: 1.6,
        }}
      >
        {message}
      </p>
      <button
        onClick={() => { window.location.reload(); }}
        style={{
          marginTop: '8px',
          padding: '8px 20px',
          fontSize: '13px',
          fontWeight: 500,
          color: '#fff',
          background: '#3b3b6b',
          border: '1px solid #5050a0',
          borderRadius: '6px',
          cursor: 'pointer',
        }}
      >
        Reload
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Startup watchdog
// ---------------------------------------------------------------------------
// If bootstrap() is still pending after WATCHDOG_MS, something is blocking
// (IPC unavailable, plugin hanging, unresolved Promise). We fire the error
// UI so the user sees a message instead of a blank transparent window.
// The timeout is cancelled the moment bootstrap() settles (success or error).

const WATCHDOG_MS = 10_000;
let watchdogTimer: number | undefined;

function armWatchdog(): void {
  watchdogTimer = window.setTimeout((): void => {
    void renderFatalError(
      new Error(
        'Volt took too long to start (> 10 s).\n' +
        'This usually means the IPC bridge is unavailable or a background task is hanging.\n' +
        'Try restarting the application.'
      )
    );
  }, WATCHDOG_MS);
}

function disarmWatchdog(): void {
  window.clearTimeout(watchdogTimer);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function bootstrap(): Promise<void> {
  const windowLabel = getCurrentWindow().label;

  // Load language preference before rendering anything so i18n is ready.
  const [settingsResult] = await Promise.allSettled([
    invoke<{ general: { language?: string } }>('load_settings'),
  ]);
  const savedLanguage =
    settingsResult.status === 'fulfilled' ? settingsResult.value.general.language : undefined;

  try {
    await initI18n(savedLanguage);
  } catch (err) {
    console.error('[Volt] i18n init failed, falling back to defaults:', err);
  }

  // Lazy-import the ErrorBoundary once so every page gets it.
  const { ErrorBoundary } = await import('./shared/components/ErrorBoundary');

  const wrap = (node: React.ReactNode): React.ReactElement => (
    <React.StrictMode>
      <ErrorBoundary>{node}</ErrorBoundary>
    </React.StrictMode>
  );

  switch (windowLabel) {
    case 'settings': {
      const { SettingsPage } = await import('./pages/SettingsPage');
      root.render(wrap(<SettingsPage />));
      break;
    }
    case 'onboarding': {
      const { OnboardingPage } = await import('./pages/OnboardingPage');
      root.render(wrap(<OnboardingPage />));
      break;
    }
    case 'system-monitor': {
      const { SystemMonitorPage } = await import('./pages/SystemMonitorPage');
      root.render(wrap(<SystemMonitorPage />));
      break;
    }
    default: {
      const { MainPage } = await import('./pages/MainPage');
      root.render(wrap(<MainPage />));
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

armWatchdog();

bootstrap()
  .then(disarmWatchdog)
  .catch((err) => {
    disarmWatchdog();
    console.error('[Volt] Fatal bootstrap error:', err);
    void renderFatalError(err);
  });
