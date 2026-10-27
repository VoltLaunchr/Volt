import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle } from 'lucide-react';
import { Button } from '@/shared/components/ui/button';
import { Textarea } from '@/shared/components/ui/textarea';
import { SettingsStatus } from '../../settings/components/SettingsChrome';
import { SettingsRow, SettingsSection } from '../../settings/components/SettingsPrimitives';
import { useAiProfile } from '../hooks/useAiProfile';

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function AiProfileSection() {
  const { t } = useTranslation('settings');
  const { profile, updatedAt, loading, saving, error, save } = useAiProfile();
  const [draft, setDraft] = useState('');
  const [feedback, setFeedback] = useState<'idle' | 'saved'>('idle');

  // Sync the textarea once the persisted profile arrives.
  useEffect(() => {
    if (!loading) setDraft(profile);
  }, [loading, profile]);

  const dirty = draft.trim() !== profile.trim();

  const handleSave = async () => {
    try {
      await save(draft);
      setFeedback('saved');
    } catch {
      // hook surfaces `error`
    }
  };

  // Clear the "Saved" toast 2s after it appears.
  useEffect(() => {
    if (feedback !== 'saved') return;
    const id = setTimeout(() => setFeedback('idle'), 2000);
    return () => clearTimeout(id);
  }, [feedback]);

  return (
    <SettingsSection sectionId="ai.profile" showDescription>
      <SettingsRow rowId="ai.profile.context" htmlFor="ai-profile-context" stacked>
        {loading ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {t('ai.profile.loading')}
          </p>
        ) : (
          <div className="space-y-3">
            <Textarea
              id="ai-profile-context"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (feedback !== 'idle') setFeedback('idle');
              }}
              rows={4}
              placeholder={t('ai.profile.placeholder')}
              spellCheck
              className="min-h-24 resize-y"
            />
            {error && <SettingsStatus kind="error">{error}</SettingsStatus>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground" role="status">
                {feedback === 'saved' ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CheckCircle className="size-3.5" />
                    {t('ai.profile.saved')}
                  </span>
                ) : updatedAt ? (
                  t('ai.profile.lastUpdated', { date: formatTimestamp(updatedAt) })
                ) : (
                  t('ai.profile.notSaved')
                )}
              </span>
              <Button size="sm" onClick={() => void handleSave()} disabled={saving || !dirty}>
                {saving ? t('ai.profile.saving') : t('ai.profile.save')}
              </Button>
            </div>
          </div>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}
