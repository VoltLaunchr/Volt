/**
 * Integrations Panel
 * Manage API keys for external services (GitHub, Notion, etc.)
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Eye, EyeOff, ExternalLink, Loader2, Trash2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { logger } from '../../../shared/utils/logger';
import { credentialsService } from '../services/credentialsService';
import { SettingsBody, SettingsPageHeader, SettingsStatus } from './SettingsChrome';
import { SettingsRow, SettingsSection } from './SettingsPrimitives';

type IntegrationId = 'github' | 'notion';

interface IntegrationConfig {
  id: IntegrationId;
  name: string;
  docUrl: string;
  placeholder: string;
}

const INTEGRATIONS: IntegrationConfig[] = [
  {
    id: 'github',
    name: 'GitHub',
    docUrl: 'https://github.com/VoltLaunchr/volt-extensions/blob/main/plugins/github/README.md',
    placeholder: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
  {
    id: 'notion',
    name: 'Notion',
    docUrl: 'https://github.com/VoltLaunchr/volt-extensions/blob/main/plugins/notion/README.md',
    placeholder: 'secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  },
];

const SECURITY_POINTS = ['encrypted', 'neverTransmitted', 'storedLocally', 'deletable'] as const;

type TokenStatus = 'valid' | 'invalid' | 'unchecked';

export function IntegrationsPanel() {
  const { t } = useTranslation('settings');
  const [pendingDelete, setPendingDelete] = useState<IntegrationId | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [credentialsLoading, setCredentialsLoading] = useState(true);
  const [credentialsError, setCredentialsError] = useState(false);
  const [credentials, setCredentials] = useState<Record<string, boolean>>({});
  const [showTokens, setShowTokens] = useState<Record<string, boolean>>({});
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, boolean>>({});
  const [testingTokens, setTestingTokens] = useState<Record<string, boolean>>({});
  const [tokenStatus, setTokenStatus] = useState<Record<string, TokenStatus>>({});
  const [oauthLoading, setOauthLoading] = useState<Record<string, boolean>>({});

  const loadCredentials = useCallback(async () => {
    setCredentialsLoading(true);
    setCredentialsError(false);
    try {
      const entries = await Promise.all(
        INTEGRATIONS.map(
          async (integration) =>
            [
              integration.id,
              await invoke<boolean>('has_credential', { service: integration.id }),
            ] as const
        )
      );
      setCredentials(Object.fromEntries(entries));
    } catch {
      setCredentialsError(true);
    } finally {
      setCredentialsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const handleOAuthStart = async (serviceId: IntegrationId) => {
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

  const handleSaveToken = async (serviceId: IntegrationId) => {
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

  const handleTestToken = async (serviceId: IntegrationId) => {
    setTestingTokens((prev) => ({ ...prev, [serviceId]: true }));
    setErrors((prev) => ({ ...prev, [serviceId]: '' }));
    try {
      const isValid = await credentialsService.testToken(serviceId);
      setTokenStatus((prev) => ({ ...prev, [serviceId]: isValid ? 'valid' : 'invalid' }));
      if (!isValid) {
        setErrors((prev) => ({
          ...prev,
          [serviceId]: t('integrations.invalidToken', { service: serviceId }),
        }));
      }
    } catch {
      setTokenStatus((prev) => ({ ...prev, [serviceId]: 'invalid' }));
      setErrors((prev) => ({ ...prev, [serviceId]: t('integrations.testFailed') }));
    } finally {
      setTestingTokens((prev) => ({ ...prev, [serviceId]: false }));
    }
  };

  const handleDeleteToken = async (serviceId: IntegrationId) => {
    setIsDeleting(true);
    try {
      await credentialsService.deleteToken(serviceId);
      setCredentials((prev) => ({ ...prev, [serviceId]: false }));
      setTokenInputs((prev) => ({ ...prev, [serviceId]: '' }));
      setShowTokens((prev) => ({ ...prev, [serviceId]: false }));
      setTokenStatus((prev) => ({ ...prev, [serviceId]: 'unchecked' }));
      logger.info(`${serviceId} token removed`);
      setPendingDelete(null);
    } catch {
      setErrors((prev) => ({ ...prev, [serviceId]: t('integrations.deleteFailed') }));
      setPendingDelete(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="settings-page">
      <SettingsPageHeader category="integrations" />
      <SettingsBody>
        {credentialsLoading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {t('loading')}
          </p>
        ) : credentialsError ? (
          <SettingsStatus
            kind="error"
            title={t('integrations.statusError')}
            action={
              <Button variant="outline" onClick={() => void loadCredentials()}>
                {t('navigation.retry')}
              </Button>
            }
          >
            {t('integrations.statusErrorDesc')}
          </SettingsStatus>
        ) : (
          INTEGRATIONS.map((integration) => {
            const id = integration.id;
            const isConfigured = credentials[id] || false;
            const isShowingToken = showTokens[id] || false;
            const busy = loading[id] || testingTokens[id] || oauthLoading[id] || false;
            const token = tokenInputs[id] || '';
            const status = tokenStatus[id] || 'unchecked';
            const error = errors[id];
            return (
              <SettingsSection key={id} sectionId={`integrations.${id}`} showDescription>
                {error && (
                  <div className="p-2.5">
                    <SettingsStatus kind="error">{error}</SettingsStatus>
                  </div>
                )}
                {success[id] && (
                  <div className="p-2.5">
                    <SettingsStatus kind="success">{t('integrations.tokenSaved')}</SettingsStatus>
                  </div>
                )}
                {status === 'valid' && (
                  <div className="p-2.5">
                    <SettingsStatus kind="success">{t('integrations.tokenValid')}</SettingsStatus>
                  </div>
                )}
                {status === 'invalid' && !error && (
                  <div className="p-2.5">
                    <SettingsStatus kind="error">{t('integrations.tokenInvalid')}</SettingsStatus>
                  </div>
                )}
                <SettingsRow
                  rowId={`integrations.${id}.connect`}
                  badge={
                    isConfigured ? (
                      <Badge variant="secondary">
                        <CheckCircle aria-hidden="true" />
                        {t('integrations.connected')}
                      </Badge>
                    ) : undefined
                  }
                >
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleOAuthStart(id)}
                    disabled={busy || isConfigured}
                  >
                    {oauthLoading[id] ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ExternalLink size={14} aria-hidden="true" />
                    )}
                    {t('integrations.connectOAuth')}
                  </Button>
                </SettingsRow>
                <SettingsRow rowId={`integrations.${id}.token`} htmlFor={`integration-token-${id}`}>
                  <div className="flex items-center gap-1">
                    <Input
                      id={`integration-token-${id}`}
                      autoComplete="off"
                      type={isShowingToken ? 'text' : 'password'}
                      value={token}
                      onChange={(event) =>
                        setTokenInputs((previous) => ({ ...previous, [id]: event.target.value }))
                      }
                      placeholder={integration.placeholder}
                      disabled={busy}
                      className="w-64 font-mono"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={
                        isShowingToken ? t('integrations.hideToken') : t('integrations.showToken')
                      }
                      onClick={() =>
                        setShowTokens((previous) => ({ ...previous, [id]: !previous[id] }))
                      }
                    >
                      {isShowingToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </Button>
                  </div>
                </SettingsRow>
                <SettingsRow rowId={`integrations.${id}.actions`}>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <a
                      href={integration.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mr-1 inline-flex items-center gap-1 text-xs underline underline-offset-4"
                    >
                      {t('integrations.learnMore')}
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestToken(id)}
                      disabled={busy || !isConfigured}
                    >
                      {testingTokens[id] && (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      )}
                      {t('integrations.testToken')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void handleSaveToken(id)}
                      disabled={busy || !token.trim()}
                    >
                      {loading[id] && (
                        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                      )}
                      {isConfigured ? t('integrations.updateToken') : t('integrations.saveToken')}
                    </Button>
                    {isConfigured && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={t('integrations.removeCredential', {
                          service: integration.name,
                        })}
                        onClick={() => setPendingDelete(id)}
                        disabled={busy}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </SettingsRow>
              </SettingsSection>
            );
          })
        )}
        <SettingsSection sectionId="integrations.security">
          <ul className="m-0 grid list-none gap-2 p-3 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
            {SECURITY_POINTS.map((key) => (
              <li key={key} className="flex items-start gap-2">
                <CheckCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                {t(`integrations.security.${key}`)}
              </li>
            ))}
          </ul>
        </SettingsSection>
      </SettingsBody>
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {t('integrations.removeCredential', { service: pendingDelete ?? '' })}
            </DialogTitle>
            <DialogDescription>
              {t('integrations.confirmDelete', { service: pendingDelete ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={isDeleting} onClick={() => setPendingDelete(null)}>
              {t('navigation.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={isDeleting}
              onClick={() => {
                if (pendingDelete) void handleDeleteToken(pendingDelete);
              }}
            >
              {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              {t('ai.local.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
