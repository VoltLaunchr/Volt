import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, AlertCircle } from 'lucide-react';
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
    <div
      style={{
        background: 'var(--color-surface)',
        borderRadius: 12,
        border: '1px solid var(--color-hairline)',
        overflow: 'hidden',
        marginTop: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-hairline)',
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>
            {t('ai.profile.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-mute)', marginTop: 2 }}>
            {t('ai.profile.description')}
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--color-mute)', fontSize: 13 }}>
            {t('ai.profile.loading')}
          </div>
        ) : (
          <>
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (feedback !== 'idle') setFeedback('idle');
              }}
              rows={4}
              placeholder={t('ai.profile.placeholder')}
              spellCheck
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: 8,
                border: '1.5px solid var(--color-hairline)',
                background: 'var(--color-canvas)',
                color: 'var(--color-ink)',
                fontSize: 13,
                fontFamily:
                  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
                lineHeight: 1.5,
                resize: 'vertical',
                minHeight: 92,
                outline: 'none',
              }}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginTop: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--color-mute)', minHeight: 18 }}>
                {error ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: 'var(--color-accent-red)',
                    }}
                  >
                    <AlertCircle size={12} /> {error}
                  </span>
                ) : feedback === 'saved' ? (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      color: '#22c55e',
                    }}
                  >
                    <CheckCircle size={12} /> {t('ai.profile.saved')}
                  </span>
                ) : updatedAt ? (
                  <>{t('ai.profile.lastUpdated', { date: formatTimestamp(updatedAt) })}</>
                ) : (
                  <>{t('ai.profile.notSaved')}</>
                )}
              </div>

              <button
                onClick={() => void handleSave()}
                disabled={saving || !dirty}
                style={{
                  padding: '7px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: saving || !dirty ? 'not-allowed' : 'pointer',
                  opacity: saving || !dirty ? 0.5 : 1,
                }}
              >
                {saving ? t('ai.profile.saving') : t('ai.profile.save')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
