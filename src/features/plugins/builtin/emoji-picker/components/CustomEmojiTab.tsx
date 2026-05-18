import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { useCallback, useState } from 'react';
import { Sparkles, Trash2, Link as LinkIcon, Loader2, AlertCircle, Check } from 'lucide-react';
import { useCustomEmojis } from '../../../../custom-emojis';
import { useToastStore } from '../../../../../shared/components/ui/toast-store';
import { cn } from '@/lib/utils';

interface CustomEmojiTabProps {
  onAfterAction: () => void;
}

/**
 * "Custom (AI)" category content for the Emoji Picker.
 * Renders the SDXL-Emoji generator input + a grid of user-generated emojis.
 *
 * Click an emoji card        → copies the image to the clipboard (primary)
 * Click the chain-link icon → copies the file path instead (secondary)
 * Click the trash icon       → deletes the emoji from disk + index
 *
 * Picker closes on any successful action via `onAfterAction()`.
 */
export function CustomEmojiTab({ onAfterAction }: CustomEmojiTabProps) {
  const { emojis, loading, generating, hasToken, error, generate, remove } = useCustomEmojis();
  const [prompt, setPrompt] = useState('');
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || generating) return;
    const created = await generate(prompt);
    if (created) setPrompt('');
  }, [prompt, generating, generate]);

  const handleCopyImage = useCallback(
    async (id: string) => {
      if (actingOn) return;
      setActingOn(id);
      try {
        await invoke<void>('custom_emojis_copy_image', { id });
        addToast('Emoji copied as image', 'success', 2000);
        onAfterAction();
      } catch (e) {
        addToast(`Copy failed: ${String(e)}`, 'error', 3000);
      } finally {
        setActingOn(null);
      }
    },
    [actingOn, addToast, onAfterAction]
  );

  const handleCopyPath = useCallback(
    async (id: string, path: string) => {
      if (actingOn) return;
      try {
        await navigator.clipboard.writeText(path);
        setCopiedPath(id);
        setTimeout(() => setCopiedPath(null), 1200);
        addToast('File path copied', 'success', 2000);
      } catch {
        addToast('Could not copy path to clipboard', 'error', 3000);
      }
    },
    [actingOn, addToast]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (actingOn) return;
      setActingOn(id);
      try {
        await remove(id);
      } finally {
        setActingOn(null);
      }
    },
    [actingOn, remove]
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
      {/* Generator input */}
      <div className="flex gap-2 shrink-0">
        <div className="relative flex-1">
          <Sparkles
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-accent pointer-events-none"
          />
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !generating && prompt.trim()) {
                e.preventDefault();
                void handleGenerate();
              }
            }}
            placeholder="A sleeping panda holding a teacup…"
            disabled={generating || hasToken === false}
            className={cn(
              'w-full h-10 pl-9 pr-3 rounded-lg text-sm outline-none transition-all',
              'bg-surface border border-hairline text-ink',
              'focus:bg-surface-elevated focus:border-hairline-strong focus:shadow-[0_0_0_3px_rgba(168,85,247,0.15)]',
              'placeholder:text-stone',
              (generating || hasToken === false) && 'opacity-50'
            )}
          />
        </div>
        <button
          onClick={() => void handleGenerate()}
          disabled={!prompt.trim() || generating || hasToken === false}
          className={cn(
            'flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-medium transition-all',
            'bg-accent text-white',
            (!prompt.trim() || generating || hasToken === false) && 'opacity-50 cursor-not-allowed'
          )}
        >
          {generating ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles size={14} />
              Generate
            </>
          )}
        </button>
      </div>

      {/* Token / error banners */}
      {hasToken === false && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent/10 border border-accent/20 text-xs text-mute shrink-0">
          <AlertCircle size={13} className="text-accent shrink-0" />
          <span>
            Custom emoji generation requires Volt Pro (or a dev build with{' '}
            <code className="font-mono text-ink">REPLICATE_TOKEN</code> in <code className="font-mono text-ink">.env</code>).
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-accent-red/10 border border-accent-red/25 text-xs text-accent-red shrink-0">
          <AlertCircle size={13} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center text-mute py-12 gap-2">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">Loading library…</span>
        </div>
      ) : emojis.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-mute">
          <div className="text-[48px] opacity-40">✨</div>
          <div className="flex w-full max-w-sm flex-col items-center gap-1.5 text-center">
            <p className="text-base font-medium text-body">No custom emojis yet</p>
            <p className="text-sm leading-relaxed text-stone">
              Type a short prompt above and hit Generate. Newly created emojis appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2">
          {emojis.map((emoji) => {
            const src = convertFileSrc(emoji.path);
            const isPathCopied = copiedPath === emoji.id;
            const isActing = actingOn === emoji.id;
            return (
              <div
                key={emoji.id}
                className={cn(
                  'group relative aspect-square rounded-md border-2 transition-colors overflow-hidden',
                  'border-transparent hover:bg-surface-elevated hover:border-hairline',
                  isActing && 'opacity-50'
                )}
              >
                <button
                  onClick={() => void handleCopyImage(emoji.id)}
                  disabled={isActing}
                  className="absolute inset-0 flex items-center justify-center p-2 cursor-pointer"
                  title={`${emoji.prompt} — click to copy as image`}
                >
                  <img
                    src={src}
                    alt={emoji.prompt}
                    className="w-full h-full object-contain select-none pointer-events-none"
                    draggable={false}
                  />
                </button>

                {/* Hover overlay with secondary actions */}
                <div
                  className={cn(
                    'absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity',
                    'pointer-events-none group-hover:pointer-events-auto'
                  )}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleCopyPath(emoji.id, emoji.path);
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded bg-surface border border-hairline text-mute hover:text-ink hover:bg-surface-elevated"
                    title="Copy file path"
                  >
                    {isPathCopied ? <Check size={11} /> : <LinkIcon size={11} />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(emoji.id);
                    }}
                    className="w-6 h-6 flex items-center justify-center rounded bg-surface border border-hairline text-accent-red hover:bg-accent-red/10"
                    title="Delete"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
