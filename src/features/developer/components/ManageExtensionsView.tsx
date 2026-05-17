import { emit } from '@tauri-apps/api/event';
import { openPath } from '@tauri-apps/plugin-opener';
import {
  ArrowLeft,
  ChevronDown,
  Code2,
  FolderOpen,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Unlink,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import petitLogo from '../../../assets/icons/petit-logo.svg';
import { Keycap } from '../../../shared/components/ui/Keycap';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import { extensionService } from '../../extensions/services/extensionService';
import type { DevExtension, InstalledExtension } from '../../extensions/types/extension.types';

type FilterType = 'all' | 'dev' | 'installed';

interface UnifiedExtension {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  isDev: boolean;
  path: string;
  raw: DevExtension | InstalledExtension;
}

interface Props {
  onClose: () => void;
  onCreateExtension: () => void;
}

export function ManageExtensionsView({ onClose, onCreateExtension }: Props): React.JSX.Element {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [devExts, setDevExts] = useState<DevExtension[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [inst, devs] = await Promise.all([
        extensionService.getInstalledExtensions(),
        extensionService.getDevExtensions(),
      ]);
      setInstalled(inst);
      setDevExts(devs);
    } catch (err) {
      logger.error('[ManageExtensions] Failed to load:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    searchRef.current?.focus();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        onCreateExtension();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onCreateExtension]);

  const unified: UnifiedExtension[] = useMemo(() => {
    const devList: UnifiedExtension[] = devExts.map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      description: e.manifest.description,
      version: e.manifest.version,
      enabled: e.enabled,
      isDev: true,
      path: e.path,
      raw: e,
    }));
    const instList: UnifiedExtension[] = installed.map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      description: e.manifest.description,
      version: e.manifest.version,
      enabled: e.enabled,
      isDev: false,
      path: e.path,
      raw: e,
    }));
    return [...devList, ...instList];
  }, [devExts, installed]);

  const filtered = useMemo(() => {
    return unified.filter((e) => {
      if (filter === 'dev' && !e.isDev) return false;
      if (filter === 'installed' && e.isDev) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (!e.name.toLowerCase().includes(q) && !e.description.toLowerCase().includes(q))
          return false;
      }
      return true;
    });
  }, [unified, filter, search]);

  const notifyReload = async (action: 'load' | 'unload' | 'reload', id: string) => {
    try {
      await emit('extension-changed', { action, extensionId: id });
    } catch {
      // non-critical
    }
  };

  const handleToggle = useCallback(
    async (ext: UnifiedExtension) => {
      setActionError(null);
      try {
        if (ext.isDev) {
          await extensionService.toggleDevExtension(ext.id, !ext.enabled);
        } else {
          await extensionService.toggleExtension(ext.id, !ext.enabled);
        }
        await notifyReload(ext.enabled ? 'unload' : 'load', ext.id);
        await load();
      } catch (err) {
        setActionError(extractErrorMessage(err));
      }
    },
    [load]
  );

  const handleUninstall = useCallback(
    async (ext: UnifiedExtension) => {
      setActionError(null);
      try {
        if (ext.isDev) {
          await extensionService.unlinkDevExtension(ext.id);
        } else {
          await extensionService.uninstallExtension(ext.id);
        }
        await notifyReload('unload', ext.id);
        await load();
      } catch (err) {
        setActionError(extractErrorMessage(err));
      }
    },
    [load]
  );

  const handleRefreshDev = useCallback(
    async (ext: UnifiedExtension) => {
      setActionError(null);
      try {
        await extensionService.refreshDevExtension(ext.id);
        await notifyReload('reload', ext.id);
        await load();
      } catch (err) {
        setActionError(extractErrorMessage(err));
      }
    },
    [load]
  );

  const handleOpenFolder = useCallback(async (ext: UnifiedExtension) => {
    try {
      await openPath(ext.path);
    } catch (err) {
      logger.error('[ManageExtensions] Failed to open folder:', err);
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
        <button
          onClick={onClose}
          className="text-ash hover:text-on-dark transition-colors p-1 rounded"
          aria-label="Back"
        >
          <ArrowLeft size={15} />
        </button>

        <div className="flex items-center gap-2 flex-1 bg-surface-elevated border border-hairline rounded-md px-2.5 py-1">
          <Search size={13} className="text-ash shrink-0" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your extensions..."
            className="flex-1 bg-transparent text-sm text-on-dark outline-none placeholder:text-ash"
          />
        </div>

        <div className="relative">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as FilterType)}
            className="appearance-none bg-surface-elevated border border-hairline rounded-md pl-3 pr-7 py-1 text-xs text-on-dark outline-none focus:border-hairline-strong cursor-pointer"
          >
            <option value="all">All Types</option>
            <option value="dev">Dev Extensions</option>
            <option value="installed">Installed</option>
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-ash pointer-events-none" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin text-ash" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            hasExtensions={unified.length > 0}
            onCreateExtension={onCreateExtension}
          />
        ) : (
          <div className="py-1">
            {actionError && (
              <div className="mx-3 mt-2 mb-1 px-3 py-2 text-xs text-red-400 bg-red-500/10 rounded-md">
                {actionError}
              </div>
            )}
            {filtered.map((ext) => (
              <ExtensionRow
                key={ext.id}
                ext={ext}
                onToggle={handleToggle}
                onUninstall={handleUninstall}
                onRefresh={handleRefreshDev}
                onOpenFolder={handleOpenFolder}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between h-8 px-3 border-t border-hairline bg-canvas shrink-0">
        <div className="flex items-center gap-2">
          <img src={petitLogo} alt="Logo" className="h-3.5 w-auto opacity-60" />
          <span className="text-xs text-ash">Manage Extensions</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onCreateExtension}
            className="flex items-center gap-1.5 text-xs text-ash hover:text-on-dark transition-colors"
          >
            <span>Create New Extension</span>
            <Keycap>Ctrl</Keycap>
            <Keycap>N</Keycap>
          </button>
        </div>
      </footer>
    </div>
  );
}

function EmptyState({
  hasExtensions,
  onCreateExtension,
}: {
  hasExtensions: boolean;
  onCreateExtension: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <div className="relative w-16 h-16 flex items-center justify-center">
        <Package size={40} className="text-ash/30" />
        <Search size={18} className="text-ash/50 absolute bottom-0 right-0" />
      </div>
      <div>
        <p className="font-semibold text-on-dark text-sm">
          {hasExtensions ? 'No Extensions Found' : 'No Extensions Found'}
        </p>
        <p className="text-xs text-ash mt-1">
          {hasExtensions
            ? 'No extensions match your search.'
            : 'Create your first extension to get started.'}
        </p>
      </div>
      {!hasExtensions && (
        <button
          onClick={onCreateExtension}
          className="px-4 py-1.5 text-sm rounded-md border border-hairline hover:bg-surface-elevated transition-colors text-on-dark"
        >
          Create Extension
        </button>
      )}
    </div>
  );
}

function ExtensionRow({
  ext,
  onToggle,
  onUninstall,
  onRefresh,
  onOpenFolder,
}: {
  ext: UnifiedExtension;
  onToggle: (e: UnifiedExtension) => Promise<void>;
  onUninstall: (e: UnifiedExtension) => Promise<void>;
  onRefresh: (e: UnifiedExtension) => Promise<void>;
  onOpenFolder: (e: UnifiedExtension) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const wrap = (fn: (e: UnifiedExtension) => Promise<void>) => () => {
    setBusy(true);
    void fn(ext).finally(() => setBusy(false));
  };

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-elevated/40 transition-colors group">
      <div className="w-8 h-8 rounded-md bg-surface-elevated border border-hairline flex items-center justify-center shrink-0">
        <Code2 size={16} className="text-ash" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium text-on-dark truncate">{ext.name}</span>
          <span className="text-[10px] text-ash/60 font-mono">v{ext.version}</span>
          {ext.isDev && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-accent-blue/15 text-accent-blue font-medium">
              DEV
            </span>
          )}
        </div>
        {ext.description && (
          <p className="text-xs text-ash truncate">{ext.description}</p>
        )}
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {ext.isDev && (
          <>
            <ActionBtn
              title="Open folder"
              onClick={wrap(onOpenFolder)}
              disabled={busy}
            >
              <FolderOpen size={13} />
            </ActionBtn>
            <ActionBtn title="Refresh" onClick={wrap(onRefresh)} disabled={busy}>
              <RefreshCw size={13} />
            </ActionBtn>
            <ActionBtn
              title="Unlink"
              onClick={wrap(onUninstall)}
              disabled={busy}
              danger
            >
              <Unlink size={13} />
            </ActionBtn>
          </>
        )}
        {!ext.isDev && (
          <ActionBtn
            title="Uninstall"
            onClick={wrap(onUninstall)}
            disabled={busy}
            danger
          >
            <Trash2 size={13} />
          </ActionBtn>
        )}
      </div>

      <button
        onClick={wrap(onToggle)}
        disabled={busy}
        className="shrink-0 text-ash hover:text-on-dark transition-colors disabled:opacity-50"
        title={ext.enabled ? 'Disable' : 'Enable'}
      >
        {ext.enabled ? (
          <ToggleRight size={20} className="text-accent-blue" />
        ) : (
          <ToggleLeft size={20} />
        )}
      </button>
    </div>
  );
}

function ActionBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors disabled:opacity-50 ${
        danger
          ? 'text-ash hover:text-red-400 hover:bg-red-500/10'
          : 'text-ash hover:text-on-dark hover:bg-surface-elevated'
      }`}
    >
      {children}
    </button>
  );
}
