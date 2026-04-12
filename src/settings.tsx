import React from 'react';
import ReactDOM from 'react-dom/client';
import { SettingsApp } from './features/settings/SettingsApp';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
);
