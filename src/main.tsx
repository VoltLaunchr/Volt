import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initI18n } from './i18n';
import './styles/global.css';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

function renderFatalError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'rgba(20, 20, 30, 0.95)',
        color: '#e0e0e0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        gap: '12px',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Volt failed to start</h1>
      <p style={{ fontSize: '13px', color: '#999', margin: 0, maxWidth: '400px', wordBreak: 'break-word' }}>
        {message}
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: '8px',
          padding: '8px 20px',
          fontSize: '13px',
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

async function bootstrap() {
  const windowLabel = getCurrentWindow().label;

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

  switch (windowLabel) {
    case 'settings': {
      const { SettingsPage } = await import('./pages/SettingsPage');
      root.render(
        <React.StrictMode>
          <SettingsPage />
        </React.StrictMode>
      );
      break;
    }
    case 'onboarding': {
      const { OnboardingPage } = await import('./pages/OnboardingPage');
      root.render(
        <React.StrictMode>
          <OnboardingPage />
        </React.StrictMode>
      );
      break;
    }
    case 'system-monitor': {
      const { SystemMonitorPage } = await import('./pages/SystemMonitorPage');
      root.render(
        <React.StrictMode>
          <SystemMonitorPage />
        </React.StrictMode>
      );
      break;
    }
    default: {
      const { MainPage } = await import('./pages/MainPage');
      const { ErrorBoundary } = await import('./shared/components/ErrorBoundary');
      root.render(
        <React.StrictMode>
          <ErrorBoundary>
            <MainPage />
          </ErrorBoundary>
        </React.StrictMode>
      );
    }
  }
}

bootstrap().catch((err) => {
  console.error('[Volt] Fatal bootstrap error:', err);
  renderFatalError(err);
});
