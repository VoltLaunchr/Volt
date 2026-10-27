import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Trash2 } from 'lucide-react';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { extractErrorMessage } from '../../../shared/utils/error';
import { credentialsService } from '../services/credentialsService';
import { SettingsRow, SettingsSection } from './SettingsPrimitives';

const BRAVE_SEARCH_SERVICE = 'brave-search' as const;

type CredentialStatus = 'idle' | 'saved' | 'valid' | 'invalid' | 'deleted';

/** Optional Brave Search API key; the key lives in the OS credential vault, never in settings. */
export function BraveKeySection() {
  const { t } = useTranslation('settings');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<CredentialStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void credentialsService.hasToken(BRAVE_SEARCH_SERVICE).then((present) => {
      if (!cancelled) setHasKey(present);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setStatus('idle');
    try {
      await action();
    } catch (actionError) {
      setError(extractErrorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const key = apiKey.trim();
    if (!key) {
      setError(t('fallbacks.brave.keyRequired'));
      return;
    }
    await run(async () => {
      await credentialsService.saveToken(BRAVE_SEARCH_SERVICE, key);
      setApiKey('');
      setHasKey(true);
      setStatus('saved');
    });
  };

  const test = () =>
    run(async () => {
      try {
        const valid = await credentialsService.testToken(BRAVE_SEARCH_SERVICE);
        setStatus(valid ? 'valid' : 'invalid');
      } catch (testError) {
        setStatus('invalid');
        throw testError;
      }
    });

  const remove = async () => {
    if (!window.confirm(t('fallbacks.brave.confirmDelete'))) return;
    await run(async () => {
      await credentialsService.deleteToken(BRAVE_SEARCH_SERVICE);
      setApiKey('');
      setHasKey(false);
      setStatus('deleted');
    });
  };

  const typing = apiKey.trim().length > 0;

  return (
    <SettingsSection sectionId="web-search.brave" showDescription>
      <SettingsRow
        rowId="web-search.brave.key"
        htmlFor="brave-search-api-key"
        badge={
          hasKey ? (
            <Badge variant="secondary">{t('fallbacks.brave.configured')}</Badge>
          ) : (
            <Badge variant="outline">{t('fallbacks.brave.notConfigured')}</Badge>
          )
        }
      >
        <Input
          id="brave-search-api-key"
          type="password"
          className="w-64"
          value={apiKey}
          onChange={(event) => {
            setApiKey(event.target.value);
            setError(null);
            setStatus('idle');
          }}
          placeholder={t('fallbacks.brave.apiKeyPlaceholder')}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
      </SettingsRow>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div className="min-h-5 text-xs" role="status" aria-live="polite" aria-atomic="true">
          {error ? (
            <span className="text-destructive">{error}</span>
          ) : status !== 'idle' ? (
            <span className={status === 'invalid' ? 'text-destructive' : 'text-success'}>
              {t(`fallbacks.brave.status.${status}`)}
            </span>
          ) : !hasKey ? (
            <span className="text-muted-foreground">{t('fallbacks.brave.disabledWithoutKey')}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {hasKey && (
            <Button
              type="button"
              size="sm"
              variant="destructive"
              onClick={() => void remove()}
              disabled={busy}
            >
              <Trash2 size={14} aria-hidden="true" />
              {t('fallbacks.brave.delete')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void test()}
            disabled={busy || !hasKey || typing}
            title={typing ? t('fallbacks.brave.saveBeforeTest') : undefined}
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {t('fallbacks.brave.test')}
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={busy || !typing}>
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {hasKey ? t('fallbacks.brave.update') : t('fallbacks.brave.save')}
          </Button>
        </div>
      </div>
    </SettingsSection>
  );
}
