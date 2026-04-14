/**
 * Integrations Panel
 * Manage API keys for external services (GitHub, Notion, etc.)
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Github,
  Database,
  AlertCircle,
  CheckCircle,
  Eye,
  EyeOff,
  Trash2,
  ExternalLink,
  Loader2,
  Key,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../../../shared/utils/logger';
import { credentialsService } from '../services/credentialsService';

interface IntegrationConfig {
  id: 'github' | 'notion';
  name: string;
  icon: LucideIcon;
  descriptionKey: string;
  setupUrl: string;
  docUrl: string;
  placeholder: string;
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    icon: Github,
    descriptionKey: 'integrations.github.description',
    setupUrl: 'https://voltlaunchr.com/api/oauth/github',
    docUrl: 'https://github.com/VoltLaunchr/volt-extensions/blob/main/plugins/github/README.md',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: Database,
    descriptionKey: 'integrations.notion.description',
    setupUrl: 'https://voltlaunchr.com/api/oauth/notion',
    docUrl: 'https://github.com/VoltLaunchr/volt-extensions/blob/main/plugins/notion/README.md',
    placeholder: 'secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
];

export function IntegrationsPanel() {
  const { t } = useTranslation('settings');
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, boolean>>({});
  const [testingTokens, setTestingTokens] = useState<Record<string, boolean>>({});
  const [tokenStatus, setTokenStatus] = useState<Record<string, 'valid' | 'invalid' | 'unchecked'>>({});
  const [oauthLoading, setOauthLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loadCredentials = async () => {
      const status: Record<string, boolean> = {};
      for (const integration of INTEGRATIONS) {
        const hasToken = await credentialsService.hasToken(integration.id);
        status[integration.id] = hasToken;
      }
      setCredentials(status);
    };
    loadCredentials();
  }, []);

  const handleOAuthStart = async (serviceId: 'github' | 'notion') => {
    setOauthLoading((prev) => ({ ...prev, [serviceId]: true }));
    setErrors((prev) => ({ ...prev, [serviceId]: '' }));
    try {
      const command = serviceId === 'github' ? 'get_github_oauth_url' : 'get_notion_oauth_url';
      const url = await invoke<string>(command);
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener');
        await openUrl(url);
      } catch {
        logger.warn('Tauri opener unavailable, falling back to window.open');
        window.open(url, '_blank');
      }
      setOauthLoading((prev) => ({ ...prev, [serviceId]: false }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('integrations.oauthFailed');
      setErrors((prev) => ({ ...prev, [serviceId]: errorMessage }));
      setOauthLoading((prev) => ({ ...prev, [serviceId]: false }));
      logger.error(`OAuth start failed for ${serviceId}:`, error);
    }
  };

  const handleSaveToken = async (serviceId: 'github' | 'notion') => {
    const token = tokenInputs[serviceId];
    if (!token || token.trim().length === 0) {
      setErrors((prev) => ({ ...prev, [serviceId]: t('integrations.tokenEmpty') }));
      return;
    }
    setLoading((prev) => ({ ...prev, [serviceId]: true }));
    setErrors((prev) => ({ ...prev, [serviceId]: '' }));
    try {
      await credentialsService.saveToken(serviceId, token);
      setCredentials((prev) => ({ ...prev, [serviceId]: true }));
      setTokenInputs((prev) => ({ ...prev, [serviceId]: '' }));
      setSuccess((prev) => ({ ...prev, [serviceId]: true }));
      setTokenStatus((prev) => ({ ...prev, [serviceId]: 'unchecked' }));
      setTimeout(() => setSuccess((prev) => ({ ...prev, [serviceId]: false })), 3000);
      logger.info(`${serviceId} token saved successfully`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('integrations.saveFailed');
      setErrors((prev) => ({ ...prev, [serviceId]: errorMessage }));
      logger.error(`Failed to save ${serviceId} token:`, error);
    } finally {
      setLoading((prev) => ({ ...prev, [serviceId]: false }));
    }
  };

  const handleTestToken = async (serviceId: 'github' | 'notion') => {
    const token = tokenInputs[serviceId];
    if (!token || token.trim().length === 0) {
      setErrors((prev) => ({ ...prev, [serviceId]: t('integrations.enterTokenFirst') }));
      return;
    }
    setTestingTokens((prev) => ({ ...prev, [serviceId]: true }));
    setErrors((prev) => ({ ...prev, [serviceId]: '' }));
    try {
      const isValid = await credentialsService.testToken(serviceId, token);
      setTokenStatus((prev) => ({ ...prev, [serviceId]: isValid ? 'valid' : 'invalid' }));
      if (!isValid) {
        setErrors((prev) => ({ ...prev, [serviceId]: t('integrations.invalidToken', { service: serviceId }) }));
      }
    } catch {
      setTokenStatus((prev) => ({ ...prev, [serviceId]: 'invalid' }));
      setErrors((prev) => ({ ...prev, [serviceId]: t('integrations.testFailed') }));
    } finally {
      setTestingTokens((prev) => ({ ...prev, [serviceId]: false }));
    }
  };

  const handleDeleteToken = async (serviceId: 'github' | 'notion') => {
    if (!window.confirm(t('integrations.confirmDelete', { service: serviceId }))) return;
    try {
      await credentialsService.deleteToken(serviceId);
      setCredentials((prev) => ({ ...prev, [serviceId]: false }));
      setTokenInputs((prev) => ({ ...prev, [serviceId]: '' }));
      setShowTokens((prev) => ({ ...prev, [serviceId]: false }));
      setTokenStatus((prev) => ({ ...prev, [serviceId]: 'unchecked' }));
      logger.info(`${serviceId} token removed`);
    } catch {
      setErrors((prev) => ({ ...prev, [serviceId]: t('integrations.deleteFailed') }));
    }
  };

  return (
    <div className="settings-panel">
      <div className="settings-panel-header">
        <h2 className="settings-panel-title">{t('integrations.title')}</h2>
      </div>
      <div className="settings-panel-content">
        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginBottom: 20 }}>
          {t('integrations.description')}
        </p>

        {INTEGRATIONS.map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            isConfigured={credentials[integration.id] || false}
            token={tokenInputs[integration.id] || ''}
            isShowingToken={showTokens[integration.id] || false}
            isLoading={loading[integration.id] || false}
            isTesting={testingTokens[integration.id] || false}
            isOAuthLoading={oauthLoading[integration.id] || false}
            error={errors[integration.id]}
            success={success[integration.id] || false}
            tokenStatus={tokenStatus[integration.id] || 'unchecked'}
            onTokenChange={(value) => setTokenInputs((prev) => ({ ...prev, [integration.id]: value }))}
            onToggleVisibility={() =>
              setShowTokens((prev) => ({ ...prev, [integration.id]: !prev[integration.id] }))
            }
            onSave={() => handleSaveToken(integration.id)}
            onTest={() => handleTestToken(integration.id)}
            onDelete={() => handleDeleteToken(integration.id)}
            onOAuthStart={() => handleOAuthStart(integration.id)}
            t={t}
          />
        ))}

        {/* Security Notice */}
        <div style={{
          marginTop: 24,
          padding: 16,
          borderRadius: 10,
          background: 'rgba(99, 102, 241, 0.08)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          display: 'flex',
          gap: 12,
        }}>
          <Shield size={18} style={{ color: 'var(--color-accent)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <p style={{ fontWeight: 600, marginBottom: 6 }}>{t('integrations.security.title')}</p>
            <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>{t('integrations.security.encrypted')}</li>
              <li>{t('integrations.security.neverTransmitted')}</li>
              <li>{t('integrations.security.storedLocally')}</li>
              <li>{t('integrations.security.deletable')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface IntegrationCardProps {
  integration: IntegrationConfig;
  isConfigured: boolean;
  token: string;
  isShowingToken: boolean;
  isLoading: boolean;
  isTesting: boolean;
  isOAuthLoading: boolean;
  error?: string;
  success?: boolean;
  tokenStatus: 'valid' | 'invalid' | 'unchecked';
  onTokenChange: (value: string) => void;
  onToggleVisibility: () => void;
  onSave: () => void;
  onTest: () => void;
  onDelete: () => void;
  onOAuthStart: () => void;
  t: (key: string, options?: Record<string, string>) => string;
}

const cardStyle: React.CSSProperties = {
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.03)',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  marginBottom: 16,
  overflow: 'hidden',
};

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 16px',
  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
};

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 500,
  padding: '3px 10px',
  borderRadius: 20,
  background: 'rgba(34, 197, 94, 0.15)',
  color: '#22c55e',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 36px 8px 12px',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.06)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  outline: 'none',
  boxSizing: 'border-box',
};

const btnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '7px 14px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  border: 'none',
  transition: 'all 0.15s ease',
};

function IntegrationCard({
  integration,
  isConfigured,
  token,
  isShowingToken,
  isLoading,
  isTesting,
  isOAuthLoading,
  error,
  success,
  tokenStatus,
  onTokenChange,
  onToggleVisibility,
  onSave,
  onTest,
  onDelete,
  onOAuthStart,
  t,
}: IntegrationCardProps) {
  const Icon = integration.icon;

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={cardHeaderStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon size={20} style={{ color: 'var(--color-text-secondary)' }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text-primary)' }}>
              {integration.name}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
              {t(integration.descriptionKey)}
            </div>
          </div>
        </div>
        {isConfigured && (
          <span style={badgeStyle}>
            <CheckCircle size={12} />
            {t('integrations.connected')}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Status messages */}
        {isConfigured && !token && (
          <StatusBanner type="success" message={t('integrations.tokenSavedSecure')} />
        )}
        {error && <StatusBanner type="error" message={error} />}
        {success && <StatusBanner type="success" message={t('integrations.tokenSaved')} />}
        {tokenStatus === 'valid' && <StatusBanner type="success" message={t('integrations.tokenValid')} />}
        {tokenStatus === 'invalid' && <StatusBanner type="error" message={t('integrations.tokenInvalid')} />}

        {/* Token input */}
        <div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6,
          }}>
            <Key size={14} />
            {t('integrations.apiToken')}
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={isShowingToken ? 'text' : 'password'}
              value={token}
              onChange={(e) => onTokenChange(e.target.value)}
              placeholder={integration.placeholder}
              disabled={isLoading}
              style={{
                ...inputStyle,
                opacity: isLoading ? 0.5 : 1,
              }}
            />
            <button
              type="button"
              onClick={onToggleVisibility}
              style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', color: 'var(--color-text-tertiary)',
                cursor: 'pointer', padding: 4,
              }}
            >
              {isShowingToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 12 }}>
            <a href={integration.setupUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--color-accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {t('integrations.getToken')} <ExternalLink size={10} />
            </a>
            <span style={{ color: 'var(--color-text-tertiary)' }}>/</span>
            <a href={integration.docUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--color-accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {t('integrations.learnMore')} <ExternalLink size={10} />
            </a>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
          <button
            onClick={onOAuthStart}
            disabled={isOAuthLoading || isConfigured}
            style={{
              ...btnBase,
              width: '100%',
              background: isConfigured ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.8)',
              color: isConfigured ? '#22c55e' : '#fff',
              opacity: (isOAuthLoading || isConfigured) ? 0.6 : 1,
              cursor: (isOAuthLoading || isConfigured) ? 'not-allowed' : 'pointer',
            }}
          >
            {isOAuthLoading && <Loader2 size={14} className="animate-spin" />}
            {isConfigured ? t('integrations.connectedOAuth') : t('integrations.connectOAuth')}
          </button>

          {!isConfigured && (
            <div style={{
              textAlign: 'center', fontSize: 11, color: 'var(--color-text-tertiary)',
              padding: '4px 0', borderTop: '1px solid rgba(255,255,255,0.06)',
            }}>
              {t('integrations.pasteManually')}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={onTest}
              disabled={isLoading || isTesting || !token}
              style={{
                ...btnBase,
                background: 'rgba(255, 255, 255, 0.06)',
                color: 'var(--color-text-secondary)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                opacity: (isLoading || isTesting || !token) ? 0.4 : 1,
                cursor: (isLoading || isTesting || !token) ? 'not-allowed' : 'pointer',
              }}
            >
              {isTesting && <Loader2 size={14} className="animate-spin" />}
              {t('integrations.testToken')}
            </button>

            <button
              onClick={onSave}
              disabled={isLoading || !token}
              style={{
                ...btnBase,
                flex: 1,
                background: 'var(--color-accent)',
                color: '#fff',
                opacity: (isLoading || !token) ? 0.4 : 1,
                cursor: (isLoading || !token) ? 'not-allowed' : 'pointer',
              }}
            >
              {isLoading && <Loader2 size={14} className="animate-spin" />}
              {isConfigured ? t('integrations.updateToken') : t('integrations.saveToken')}
            </button>

            {isConfigured && (
              <button
                onClick={onDelete}
                disabled={isLoading}
                style={{
                  ...btnBase,
                  background: 'rgba(239, 68, 68, 0.1)',
                  color: '#ef4444',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  padding: '7px 10px',
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBanner({ type, message }: { type: 'success' | 'error'; message: string }) {
  const isSuccess = type === 'success';
  const IconComponent = isSuccess ? CheckCircle : AlertCircle;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
      background: isSuccess ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
      border: `1px solid ${isSuccess ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
    }}>
      <IconComponent size={16} style={{ color: isSuccess ? '#22c55e' : '#ef4444', flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: isSuccess ? '#22c55e' : '#ef4444' }}>{message}</span>
    </div>
  );
}
