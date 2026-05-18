import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { openPath, openUrl } from '@tauri-apps/plugin-opener';
import {
  ArrowLeft,
  BookOpen,
  CheckCircle,
  Code,
  FolderOpen,
  Loader2,
  Plus,
  Trash2,
  User,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import { EXTENSION_CATEGORIES } from '../../extensions/types/extension.types';
import type { DevExtension } from '../../extensions/types/extension.types';

interface ScaffoldCommand {
  name: string;
  title: string;
  description: string;
}

interface Props {
  onClose: () => void;
}

const CATEGORIES = EXTENSION_CATEGORIES.filter((c) => c.id !== 'all').map((c) => ({
  value: c.id,
  label: c.label,
}));

const PLATFORMS = [
  { value: 'windows_macos', label: 'Windows & macOS' },
  { value: 'windows', label: 'Windows only' },
  { value: 'macos', label: 'macOS only' },
];

const INPUT_CLS =
  'w-full bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash disabled:opacity-50';

type Step = 'info' | 'commands' | 'success';

function toSnakeCase(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'command'
  );
}

function emptyCommand(): ScaffoldCommand {
  return { name: '', title: '', description: '' };
}

export function CreateExtensionView({ onClose }: Props): React.JSX.Element {
  const { isAuthenticated, isLoading: isAuthLoading, login } = useAuth();

  const [step, setStep] = useState<Step>('info');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [platforms, setPlatforms] = useState('windows_macos');
  const [category, setCategory] = useState('developer');
  const [location, setLocation] = useState('');
  const [commands, setCommands] = useState<ScaffoldCommand[]>([emptyCommand()]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DevExtension | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const firstCmdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === 'info' && isAuthenticated) nameRef.current?.focus();
  }, [step, isAuthenticated]);

  useEffect(() => {
    if (step === 'commands') firstCmdRef.current?.focus();
  }, [step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const pickFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setLocation(selected);
  }, []);

  const updateCommand = useCallback(
    (index: number, field: keyof ScaffoldCommand, value: string) => {
      setCommands((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], [field]: value };
        if (field === 'title') next[index].name = toSnakeCase(value);
        return next;
      });
    },
    []
  );

  const addCommand = useCallback(() => {
    setCommands((prev) => [...prev, emptyCommand()]);
  }, []);

  const removeCommand = useCallback((index: number) => {
    setCommands((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleContinue = useCallback(() => {
    if (!name.trim()) {
      setError('Extension name is required');
      return;
    }
    if (!location) {
      setError('Choose a location for the extension');
      return;
    }
    setError(null);
    setStep('commands');
  }, [name, location]);

  const handleSubmit = useCallback(async () => {
    setError(null);
    setIsLoading(true);
    try {
      const validCommands = commands
        .filter((c) => c.title.trim())
        .map((c) => ({
          name: c.name || toSnakeCase(c.title),
          title: c.title.trim(),
          description: c.description.trim() || undefined,
        }));

      const ext = await invoke<DevExtension>('scaffold_extension', {
        name: name.trim(),
        description: description.trim(),
        category,
        platforms,
        prefix: null,
        keywords: null,
        location,
        commands: validCommands.length > 0 ? validCommands : null,
      });
      setCreated(ext);
      setStep('success');
    } catch (err) {
      setError(extractErrorMessage(err));
      logger.error('scaffold_extension failed:', err);
    } finally {
      setIsLoading(false);
    }
  }, [name, description, category, platforms, location, commands]);

  // ── Auth gate ────────────────────────────────────────────────────────────────
  if (isAuthLoading) {
    return (
      <div className="flex items-center justify-center flex-1 h-full">
        <Loader2 size={20} className="animate-spin text-ash" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-ash hover:text-on-dark transition-colors"
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <span className="ml-2 text-sm font-medium text-on-dark flex items-center gap-2">
            <Code size={15} className="text-ash" />
            Create Extension
          </span>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8 text-center">
          <div className="relative">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-hairline bg-surface-elevated">
              <User size={28} className="text-ash" />
            </div>
            <div className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-xs font-semibold text-white">
              !
            </div>
          </div>

          <div className="flex w-full max-w-sm flex-col gap-2">
            <p className="text-base font-semibold text-on-dark">Sign In Required</p>
            <p className="text-sm leading-relaxed text-ash">
              You must be signed in to create an extension. We use your account to
              link the extension to your developer profile on voltlaunchr.com.
            </p>
          </div>

          <button
            onClick={() => {
              void login();
            }}
            className="rounded-md border border-hairline px-5 py-2 text-sm text-on-dark transition-colors hover:bg-surface-elevated"
          >
            Sign In
          </button>

          <button
            onClick={() => {
              void openUrl('https://voltlaunchr.com/auth');
            }}
            className="text-xs text-ash transition-colors hover:text-accent-blue"
          >
            Sign-in window didn&apos;t open?{' '}
            <span className="text-accent-blue underline">Open auth in browser</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (step === 'success' && created) {
    return (
      <div className="flex flex-col h-full px-4 py-3 gap-4">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-ash hover:text-on-dark transition-colors w-fit"
        >
          <ArrowLeft size={14} />
          Back
        </button>

        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center">
          <div className="rounded-full bg-green-500/15 p-4">
            <CheckCircle size={32} className="text-green-400" />
          </div>
          <div>
            <p className="font-semibold text-on-dark text-base">
              {created.manifest.name} created
            </p>
            <p className="text-xs text-ash mt-1 font-mono break-all">{created.path}</p>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => {
                void openPath(created.path);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-surface-elevated hover:bg-surface-elevated/80 border border-hairline transition-colors"
            >
              <FolderOpen size={14} />
              Open folder
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md border border-hairline hover:bg-surface-elevated transition-colors"
            >
              Done
            </button>
          </div>
          <p className="w-full max-w-sm text-xs leading-relaxed text-ash">
            The extension has been linked as a dev extension. Reload Volt to activate it.
          </p>
        </div>
      </div>
    );
  }

  // ── Header (shared) ──────────────────────────────────────────────────────────
  const header = (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline shrink-0">
      <button
        onClick={step === 'commands' ? () => setStep('info') : onClose}
        className="flex items-center gap-1.5 text-sm text-ash hover:text-on-dark transition-colors"
      >
        <ArrowLeft size={14} />
        Back
      </button>
      <div className="flex items-center gap-2 ml-2 flex-1">
        <Code size={15} className="text-ash" />
        <span className="text-sm font-medium text-on-dark">Create Extension</span>
        {step === 'commands' && (
          <span className="text-xs text-ash ml-1">— Add Commands</span>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          void openUrl('https://voltlaunchr.com/docs/plugins');
        }}
        className="flex items-center gap-1 text-xs text-ash hover:text-on-dark transition-colors ml-auto"
      >
        <BookOpen size={12} />
        Open Documentation
      </button>
    </div>
  );

  // ── Step 1: Extension Info ────────────────────────────────────────────────────
  if (step === 'info') {
    return (
      <div className="flex flex-col h-full">
        {header}
        <div className="flex flex-col gap-3 px-4 py-4 overflow-y-auto flex-1">
          <Field label="Extension Title" required>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Linear"
              className={INPUT_CLS}
            />
          </Field>

          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does the extension do?"
              rows={3}
              className={`${INPUT_CLS} resize-none leading-relaxed`}
            />
          </Field>

          <Field label="Platforms">
            <select
              value={platforms}
              onChange={(e) => setPlatforms(e.target.value)}
              className={`${INPUT_CLS} cursor-pointer`}
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Categories">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`${INPUT_CLS} cursor-pointer`}
            >
              <option value="">Select categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Location" required>
            <button
              type="button"
              onClick={() => {
                void pickFolder();
              }}
              className={`${INPUT_CLS} flex items-center gap-2 text-left ${location ? 'text-on-dark' : 'text-ash'} cursor-pointer hover:border-hairline-strong`}
            >
              <FolderOpen size={14} className="shrink-0 text-ash" />
              <span className="truncate">{location || 'extensions'}</span>
            </button>
            <p className="text-xs text-ash/70 mt-1">
              Directory containing your extensions development sources.
            </p>
          </Field>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-hairline shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-ash">
            <span className="font-medium text-on-dark">Developer</span>
          </div>
          <button
            onClick={handleContinue}
            disabled={!name.trim() || !location}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Code size={14} />
            Create Extension
          </button>
        </div>
      </div>
    );
  }

  // ── Step 2: Commands ──────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex flex-col gap-4 px-4 py-4 overflow-y-auto flex-1">
        {commands.map((cmd, i) => (
          <CommandForm
            key={i}
            cmd={cmd}
            index={i}
            inputRef={i === 0 ? firstCmdRef : undefined}
            isOnly={commands.length === 1}
            onChange={updateCommand}
            onRemove={removeCommand}
          />
        ))}

        <button
          type="button"
          onClick={addCommand}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-md bg-surface-elevated border border-hairline hover:bg-surface-elevated/80 transition-colors text-sm text-ash hover:text-on-dark"
        >
          <Plus size={14} />
          Add New Command
        </button>

        {error && (
          <p className="text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">{error}</p>
        )}
      </div>

      <div className="flex items-center justify-between px-4 py-3 border-t border-hairline shrink-0">
        <div className="flex items-center gap-1.5 text-xs text-ash">
          <span className="font-medium text-on-dark">Developer</span>
        </div>
        <button
          onClick={() => {
            void handleSubmit();
          }}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-4 py-1.5 text-sm rounded-md bg-accent-blue text-white hover:bg-accent-blue/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Code size={14} />}
          Create Extension
        </button>
      </div>
    </div>
  );
}

function CommandForm({
  cmd,
  index,
  inputRef,
  isOnly,
  onChange,
  onRemove,
}: {
  cmd: ScaffoldCommand;
  index: number;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  isOnly: boolean;
  onChange: (i: number, field: keyof ScaffoldCommand, value: string) => void;
  onRemove: (i: number) => void;
}) {
  const INPUT = 'w-full bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash';

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg bg-surface-elevated/40 border border-hairline">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-ash">Command {index + 1}</span>
        {!isOnly && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-ash hover:text-red-400 transition-colors"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-ash">Command Title</label>
        <input
          ref={inputRef}
          type="text"
          value={cmd.title}
          onChange={(e) => onChange(index, 'title', e.target.value)}
          placeholder="Search Projects"
          className={INPUT}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-ash">Description</label>
        <textarea
          value={cmd.description}
          onChange={(e) => onChange(index, 'description', e.target.value)}
          placeholder="What does the command do?"
          rows={2}
          className={`${INPUT} resize-none leading-relaxed`}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-ash">Template</label>
        <select className={`${INPUT} cursor-pointer`} defaultValue="blank">
          <option value="blank">Blank</option>
        </select>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-ash flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}
