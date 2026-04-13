import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { SettingsApp } from './features/settings/SettingsApp';
import { initI18n } from './i18n';
import './styles/global.css';

async function bootstrap() {
  let savedLanguage: string | undefined;
  try {
    const settings = await invoke<{ general: { language?: string } }>('load_settings');
    savedLanguage = settings.general.language;
  } catch {
    // First boot or error — will auto-detect
  }

  await initI18n(savedLanguage);

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <SettingsApp />
    </React.StrictMode>
  );
}

bootstrap();
