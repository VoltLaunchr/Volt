import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, CheckCircle, AlertCircle, Edit3, X } from 'lucide-react';
import { HotkeyCapture } from '../../../shared/components/ui/HotkeyCapture';
import { useQuickActions } from '../hooks/useQuickActions';
import { PLACEHOLDER_DOCS } from '../placeholders';
import { QuickActionIcon, QUICK_ACTION_ICONS } from '../icons';
import type { AiQuickAction } from '../types';

function HotkeyChip({
  value,
  bindError,
  onChange,
  onClear,
}: {
  value: string | null | undefined;
  bindError: string | null;
  onChange: (hk: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation('settings');
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <HotkeyCapture
          value={value ?? ''}
          onChange={(hk) => {
            onChange(hk);
            setEditing(false);
          }}
        />
        <button
          onClick={() => setEditing(false)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-mute)',
            cursor: 'pointer',
            padding: 2,
            display: 'flex',
          }}
          title={t('ai.quickActions.cancel')}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  if (!value) {
    return (
      <button
        onClick={() => setEditing(true)}
        style={{
          padding: '4px 10px',
          borderRadius: 6,
          border: '1px dashed var(--color-hairline)',
          background: 'none',
          color: 'var(--color-mute)',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {t('ai.quickActions.bindHotkey')}
      </button>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button
        onClick={() => setEditing(true)}
        style={{
          fontFamily: 'ui-monospace, monospace',
          fontSize: 11,
          padding: '4px 10px',
          borderRadius: 6,
          background: bindError ? 'rgba(239,68,68,0.12)' : 'var(--color-surface)',
          border: bindError
            ? '1px solid rgba(239,68,68,0.3)'
            : '1px solid var(--color-hairline)',
          color: bindError ? '#f87171' : 'var(--color-ink)',
          cursor: 'pointer',
        }}
        title={bindError ?? t('ai.quickActions.clickToChange')}
      >
        {value}
      </button>
      <button
        onClick={onClear}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-mute)',
          cursor: 'pointer',
          padding: 2,
          display: 'flex',
        }}
        title={t('ai.quickActions.removeHotkey')}
      >
        <X size={13} />
      </button>
      {bindError && (
        <span
          style={{ fontSize: 11, color: '#f87171', display: 'flex', alignItems: 'center', gap: 4 }}
          title={bindError}
        >
          <AlertCircle size={12} /> {t('ai.quickActions.failed')}
        </span>
      )}
    </div>
  );
}

interface EditPromptModalProps {
  action: AiQuickAction;
  onClose: () => void;
  onSave: (patch: Partial<AiQuickAction>) => Promise<void>;
}

function EditPromptModal({ action, onClose, onSave }: EditPromptModalProps) {
  const { t } = useTranslation('settings');
  const [label, setLabel] = useState(action.label);
  const [system, setSystem] = useState(action.systemPrompt);
  const [icon, setIcon] = useState<string | null>(action.icon ?? 'sparkles');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!label.trim() || !system.trim()) return;
    setSaving(true);
    try {
      await onSave({ label: label.trim(), systemPrompt: system.trim(), icon });
      onClose();
    } finally {
      setSaving(false);
    }
  }, [label, system, icon, onSave, onClose]);

  const iconKeys = Object.keys(QUICK_ACTION_ICONS);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
        style={{
          background: 'var(--color-canvas)',
          borderRadius: 12,
          border: '1px solid var(--color-hairline)',
          padding: '24px',
          width: 520,
          maxWidth: 'calc(100vw - 48px)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
        }}
      >
        <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 600, color: 'var(--color-ink)' }}>
          {t('ai.quickActions.modal.title')}
        </h3>

        <label style={{ display: 'block', marginBottom: 6, fontSize: 12, color: 'var(--color-mute)' }}>
          {t('ai.quickActions.modal.icon', { defaultValue: 'Icon' })}
        </label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(38px, 1fr))',
            gap: 6,
            padding: 8,
            borderRadius: 8,
            border: '1.5px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            marginBottom: 16,
            maxHeight: 140,
            overflowY: 'auto',
          }}
        >
          {iconKeys.map((key) => {
            const selected = icon === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setIcon(key)}
                title={key}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 8,
                  border: selected
                    ? '1.5px solid var(--color-accent)'
                    : '1px solid var(--color-hairline)',
                  background: selected ? 'rgba(168,85,247,0.12)' : 'var(--color-canvas)',
                  color: selected ? 'var(--color-accent)' : 'var(--color-ink)',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.15s, border-color 0.15s',
                }}
              >
                <QuickActionIcon name={key} size={16} strokeWidth={1.8} />
              </button>
            );
          })}
        </div>

        <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--color-mute)' }}>
          {t('ai.quickActions.modal.label')}
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '9px 12px',
            borderRadius: 8,
            border: '1.5px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: 'var(--color-ink)',
            fontSize: 13,
            marginBottom: 16,
            outline: 'none',
          }}
        />

        <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--color-mute)' }}>
          {t('ai.quickActions.modal.systemPrompt')}
        </label>
        <textarea
          value={system}
          onChange={(e) => setSystem(e.target.value)}
          rows={6}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '9px 12px',
            borderRadius: 8,
            border: '1.5px solid var(--color-hairline)',
            background: 'var(--color-surface)',
            color: 'var(--color-ink)',
            fontSize: 13,
            lineHeight: 1.5,
            marginBottom: 8,
            outline: 'none',
            resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ marginBottom: 20, fontSize: 11, color: 'var(--color-mute)', lineHeight: 1.5 }}>
          <div style={{ marginBottom: 4 }}>{t('ai.quickActions.modal.placeholdersIntro')}</div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {PLACEHOLDER_DOCS.map((p) => (
              <li key={p.token} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <code style={{ fontFamily: 'ui-monospace, monospace', color: 'var(--color-ink)' }}>
                  {p.token}
                </code>
                <span>{p.description}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: '1.5px solid var(--color-hairline)',
              background: 'var(--color-surface)',
              color: 'var(--color-ink)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            {t('ai.quickActions.modal.cancel')}
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!label.trim() || !system.trim() || saving}
            style={{
              padding: '8px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              cursor: !label.trim() || !system.trim() || saving ? 'not-allowed' : 'pointer',
              opacity: !label.trim() || !system.trim() || saving ? 0.5 : 1,
            }}
          >
            {saving ? t('ai.quickActions.modal.saving') : t('ai.quickActions.modal.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function QuickActionsSection() {
  const { t } = useTranslation('settings');
  const { actions, loading, report, error, updateAction, createAction, deleteAction } = useQuickActions();
  const [editing, setEditing] = useState<AiQuickAction | null>(null);

  const handleAddCustom = useCallback(async () => {
    const draft: AiQuickAction = {
      id: `custom-${Date.now()}`,
      label: t('ai.quickActions.newAction'),
      systemPrompt: t('ai.quickActions.newPrompt'),
      hotkey: null,
      enabled: true,
      provider: null,
      icon: null,
    };
    await createAction(draft);
    // Open the editor for the freshly created action
    setEditing(draft);
  }, [createAction, t]);

  return (
    <>
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
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid var(--color-hairline)',
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-ink)' }}>
              {t('ai.quickActions.title')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-mute)', marginTop: 2 }}>
              {t('ai.quickActions.description')}
            </div>
          </div>
          <button
            onClick={() => void handleAddCustom()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '5px 10px',
              borderRadius: 7,
              border: '1.5px solid var(--color-hairline)',
              background: 'var(--color-canvas)',
              color: 'var(--color-ink)',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            <Plus size={13} /> {t('ai.quickActions.add')}
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-mute)', fontSize: 13 }}>
            {t('ai.quickActions.loading')}
          </div>
        ) : actions.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--color-mute)', fontSize: 13 }}>
            {t('ai.quickActions.empty')}
          </div>
        ) : (
          actions.map((action, idx) => {
            const bindStatus = report[action.id];
            const bindError = bindStatus && bindStatus !== 'ok' ? bindStatus : null;
            return (
              <div
                key={action.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderBottom: idx < actions.length - 1 ? '1px solid var(--color-hairline)' : 'none',
                  opacity: action.enabled ? 1 : 0.5,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--color-canvas)',
                    border: '1px solid var(--color-hairline)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--color-ink)',
                    flexShrink: 0,
                  }}
                  aria-hidden
                >
                  <QuickActionIcon name={action.icon} size={15} strokeWidth={1.8} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-ink)' }}>
                    {action.label}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--color-mute)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: 320,
                    }}
                    title={action.systemPrompt}
                  >
                    {action.systemPrompt}
                  </div>
                </div>

                <HotkeyChip
                  value={action.hotkey}
                  bindError={bindError}
                  onChange={(hk) => void updateAction(action.id, { hotkey: hk })}
                  onClear={() => void updateAction(action.id, { hotkey: null })}
                />

                {bindStatus === 'ok' && (
                  <CheckCircle size={13} style={{ color: '#22c55e', flexShrink: 0 }} />
                )}

                <button
                  onClick={() => void updateAction(action.id, { enabled: !action.enabled })}
                  style={{
                    fontSize: 11,
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid var(--color-hairline)',
                    background: 'var(--color-canvas)',
                    color: action.enabled ? 'var(--color-ink)' : 'var(--color-mute)',
                    cursor: 'pointer',
                  }}
                  title={action.enabled ? t('ai.quickActions.disable') : t('ai.quickActions.enable')}
                >
                  {action.enabled ? t('ai.quickActions.on') : t('ai.quickActions.off')}
                </button>

                <button
                  onClick={() => setEditing(action)}
                  style={{
                    padding: 5,
                    borderRadius: 6,
                    border: '1px solid var(--color-hairline)',
                    background: 'none',
                    color: 'var(--color-mute)',
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                  title={t('ai.quickActions.edit')}
                >
                  <Edit3 size={12} />
                </button>

                <button
                  onClick={() => void deleteAction(action.id)}
                  style={{
                    padding: 5,
                    borderRadius: 6,
                    border: '1px solid var(--color-hairline)',
                    background: 'none',
                    color: 'var(--color-accent-red)',
                    cursor: 'pointer',
                    display: 'flex',
                  }}
                  title={t('ai.quickActions.delete')}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 12px',
            borderRadius: 8,
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
            color: '#f87171',
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {editing && (
        <EditPromptModal
          action={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => updateAction(editing.id, patch)}
        />
      )}
    </>
  );
}
