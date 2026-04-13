import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import App from './app/App';
import { initI18n } from './i18n';
import './styles/global.css';

async function bootstrap() {
  // Load settings and init i18n in parallel for faster startup
  const [settingsResult] = await Promise.allSettled([
    invoke<{ general: { language?: string } }>('load_settings'),
  ]);

  const savedLanguage =
    settingsResult.status === 'fulfilled' ? settingsResult.value.general.language : undefined;

  await initI18n(savedLanguage);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap();
