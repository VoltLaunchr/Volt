/**
 * Extensions Store Component
 * Displays available and installed extensions with install/uninstall capabilities
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Trash2,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Star,
  Shield,
  ExternalLink,
  Search,
  Package,
  Loader2,
  ToggleLeft,
  ToggleRight,
  FolderOpen,
  Unlink,
  Code,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { emit } from '@tauri-apps/api/event';
import { cn } from '@/lib/utils';
import { logger } from '../../../shared/utils/logger';
import { extensionService } from '../services/extensionService';
import type {
  DevExtension,
  ExtensionInfo,
  InstalledExtension,
  ExtensionCategory,
} from '../types/extension.types';
import { EXTENSION_CATEGORIES } from '../types/extension.types';

const LOCAL_EXTENSION_ICONS: Record<string, string> = {
  github: '/extension-icons/github.svg',
  notion: '/extension-icons/notion.svg',
};

/**
 * Notify the main window to reload extensions
 * Since settings window is a separate webview, we use Tauri events
 */
const notifyMainWindowToReloadExtensions = async (
  action: 'load' | 'unload' | 'reload',
  extensionId: string
) => {
  try {
    await emit('extension-changed', { action, extensionId });
    logger.info(`✓ Notified main window: ${action} ${extensionId}`);
  } catch (err) {
    logger.warn('Failed to notify main window:', err);
  }
};

interface ExtensionsStoreProps {
  onRefresh?: () => void;
}

export function ExtensionsStore(_props: ExtensionsStoreProps): React.JSX.Element {
  const { t } = useTranslation('extensions');
  const [availableExtensions, setAvailableExtensions] = useState<ExtensionInfo[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [devExtensions, setDevExtensions] = useState<DevExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExtensionCategory | 'all'>('all');
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [uninstallingIds, setUninstallingIds] = useState<Set<string>>(new Set());
  const [linkingDev, setLinkingDev] = useState(false);
  const [activeTab, setActiveTab] = useState<'browse' | 'installed'>('browse');

  const loadExtensions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [registry, installed, devExts, downloadCounts] = await Promise.all([
        extensionService
          .fetchRegistry()
          .catch(() => ({ extensions: [] as ExtensionInfo[], version: '0', lastUpdated: '' })),
        extensionService.getInstalledExtensions().catch(() => [] as InstalledExtension[]),
        extensionService.getDevExtensions().catch(() => [] as DevExtension[]),
        extensionService.fetchDownloadCounts().catch(() => ({}) as Record<string, number>),
      ]);

      const extensions = registry.extensions.map((ext) => {
        const live = downloadCounts[ext.manifest.id];
        return live !== undefined ? { ...ext, downloads: live } : ext;
      });

      setAvailableExtensions(extensions);
      setInstalledExtensions(installed);
      setDevExtensions(devExts);
    } catch (err) {
      logger.error('Failed to load extensions:', err);
      setError('Failed to load extensions. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load extensions on mount
  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

  const handleInstall = useCallback(async (extension: ExtensionInfo) => {
    const extensionId = extension.manifest.id;
    setInstallingIds((prev) => new Set(prev).add(extensionId));

    try {
      const installed = await extensionService.installExtension(extensionId, extension.downloadUrl);
      setInstalledExtensions((prev) => [
        ...prev.filter((e) => e.manifest.id !== extensionId),
        installed,
      ]);

      // Auto-load the extension immediately after installation
      if (installed.enabled) {
        await notifyMainWindowToReloadExtensions('load', extensionId);
      }

      // Increment download counter in Supabase (fire-and-forget)
      void extensionService.incrementDownload(extensionId);

      // Optimistically bump the local counter
      setAvailableExtensions((prev) =>
        prev.map((ext) =>
          ext.manifest.id === extensionId ? { ...ext, downloads: ext.downloads + 1 } : ext
        )
      );
    } catch (err) {
      logger.error('Failed to install extension:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to install ${extension.manifest.name}: ${errorMessage}`);
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(extensionId);
        return next;
      });
    }
  }, []);

  const handleUninstall = useCallback(async (extensionId: string) => {
    setUninstallingIds((prev) => new Set(prev).add(extensionId));

    try {
      // Unload the extension first
      await notifyMainWindowToReloadExtensions('unload', extensionId);

      await extensionService.uninstallExtension(extensionId);
      setInstalledExtensions((prev) => prev.filter((e) => e.manifest.id !== extensionId));
    } catch (err) {
      logger.error('Failed to uninstall extension:', err);
      setError(`Failed to uninstall extension`);
    } finally {
      setUninstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(extensionId);
        return next;
      });
    }
  }, []);

  const handleToggle = useCallback(async (extensionId: string, enabled: boolean) => {
    try {
      await extensionService.toggleExtension(extensionId, enabled);
      setInstalledExtensions((prev) =>
        prev.map((e) => (e.manifest.id === extensionId ? { ...e, enabled } : e))
      );

      // Load or unload the extension based on the new state
      if (enabled) {
        await notifyMainWindowToReloadExtensions('load', extensionId);
      } else {
        await notifyMainWindowToReloadExtensions('unload', extensionId);
      }
    } catch (err) {
      logger.error('Failed to toggle extension:', err);
    }
  }, []);

  // Dev extension handlers
  const handleLinkDevExtension = useCallback(async () => {
    setLinkingDev(true);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Extension Folder',
      });

      if (selected && typeof selected === 'string') {
        const devExt = await extensionService.linkDevExtension(selected);
        setDevExtensions((prev) => [
          ...prev.filter((e) => e.manifest.id !== devExt.manifest.id),
          devExt,
        ]);

        // Auto-load the dev extension if enabled
        if (devExt.enabled) {
          await notifyMainWindowToReloadExtensions('load', devExt.manifest.id);
        }
      }
    } catch (err) {
      logger.error('Failed to link dev extension:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Failed to link extension: ${errorMessage}`);
    } finally {
      setLinkingDev(false);
    }
  }, []);

  const handleUnlinkDevExtension = useCallback(async (extensionId: string) => {
    try {
      // Unload the extension first
      await notifyMainWindowToReloadExtensions('unload', extensionId);

      await extensionService.unlinkDevExtension(extensionId);
      setDevExtensions((prev) => prev.filter((e) => e.manifest.id !== extensionId));
    } catch (err) {
      logger.error('Failed to unlink dev extension:', err);
      setError('Failed to unlink extension');
    }
  }, []);

  const handleToggleDevExtension = useCallback(async (extensionId: string, enabled: boolean) => {
    try {
      await extensionService.toggleDevExtension(extensionId, enabled);
      setDevExtensions((prev) =>
        prev.map((e) => (e.manifest.id === extensionId ? { ...e, enabled } : e))
      );

      // Load or unload the dev extension based on the new state
      if (enabled) {
        await notifyMainWindowToReloadExtensions('load', extensionId);
      } else {
        await notifyMainWindowToReloadExtensions('unload', extensionId);
      }
    } catch (err) {
      logger.error('Failed to toggle dev extension:', err);
    }
  }, []);

  const handleRefreshDevExtension = useCallback(async (extensionId: string) => {
    try {
      const refreshed = await extensionService.refreshDevExtension(extensionId);
      setDevExtensions((prev) => prev.map((e) => (e.manifest.id === extensionId ? refreshed : e)));

      // Reload the extension to pick up code changes
      if (refreshed.enabled) {
        await notifyMainWindowToReloadExtensions('reload', extensionId);
      }
    } catch (err) {
      logger.error('Failed to refresh dev extension:', err);
    }
  }, []);

  const isInstalled = useCallback(
    (extensionId: string) => installedExtensions.some((e) => e.manifest.id === extensionId),
    [installedExtensions]
  );

  // Filter extensions
  const filteredExtensions = availableExtensions.filter((ext) => {
    const matchesSearch =
      !searchQuery ||
      ext.manifest.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ext.manifest.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ext.manifest.keywords?.some((k) => k.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory = categoryFilter === 'all' || ext.manifest.category === categoryFilter;

    return matchesSearch && matchesCategory;
  });

  const filteredInstalled = installedExtensions.filter((ext) => {
    return (
      !searchQuery ||
      ext.manifest.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ext.manifest.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  const filteredDevExtensions = devExtensions.filter((ext) => {
    return (
      !searchQuery ||
      ext.manifest.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ext.manifest.description.toLowerCase().includes(searchQuery.toLowerCase())
    );
  });

  // Total installed count includes dev extensions
  const totalInstalledCount = installedExtensions.length + devExtensions.length;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-body">
        <Loader2 className="animate-spin" size={32} />
        <p className="text-sm font-medium">{t('loading')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-hairline shrink-0">
        <h2 className="flex items-center gap-2.5 m-0 text-lg font-semibold text-on-dark">
          <Package size={24} className="text-accent-blue" />
          {t('header.title')}
        </h2>
        <button
          className="w-7 h-7 rounded-sm bg-transparent border-0 text-mute cursor-pointer flex items-center justify-center transition-colors hover:bg-white/10 hover:text-on-dark"
          onClick={() => {
            void loadExtensions();
          }}
          title={t('header.refresh')}
        >
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 mx-6 mb-4 bg-accent-red-soft border border-red-500/20 rounded-md text-accent-red text-sm">
          <AlertCircle size={18} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto bg-transparent border-0 text-inherit cursor-pointer text-lg p-0 opacity-70 leading-none hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-6 mb-4">
        <button
          className={cn(
            'px-4 py-2 bg-transparent border-0 rounded-sm text-sm font-medium cursor-pointer transition-colors',
            activeTab === 'browse'
              ? 'bg-accent-blue-soft text-accent-blue'
              : 'text-body hover:bg-white/[0.06] hover:text-on-dark'
          )}
          onClick={() => setActiveTab('browse')}
        >
          {t('tabs.browse')} ({availableExtensions.length})
        </button>
        <button
          className={cn(
            'px-4 py-2 bg-transparent border-0 rounded-sm text-sm font-medium cursor-pointer transition-colors',
            activeTab === 'installed'
              ? 'bg-accent-blue-soft text-accent-blue'
              : 'text-body hover:bg-white/[0.06] hover:text-on-dark'
          )}
          onClick={() => setActiveTab('installed')}
        >
          {t('tabs.installed')} ({totalInstalledCount})
        </button>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col gap-3 px-6 mb-4">
        <div className="flex items-center gap-2.5 px-3 py-2 bg-white/[0.06] border border-white/10 rounded-md transition-colors focus-within:border-accent-blue focus-within:bg-white/[0.08]">
          <Search size={18} className="text-mute shrink-0" />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 bg-transparent border-0 outline-none text-on-dark text-sm placeholder:text-mute"
          />
        </div>

        {activeTab === 'browse' && (
          <div className="flex flex-wrap gap-1.5">
            {EXTENSION_CATEGORIES.map((cat) => {
              const IconComponent = cat.icon;
              return (
                <button
                  key={cat.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-1.5 border-0 rounded-sm text-xs font-medium cursor-pointer transition-colors',
                    categoryFilter === cat.id
                      ? 'bg-accent-blue-soft text-accent-blue'
                      : 'bg-white/[0.03] text-body hover:bg-white/[0.06] hover:text-on-dark'
                  )}
                  onClick={() => setCategoryFilter(cat.id)}
                >
                  <IconComponent size={14} className="shrink-0" />
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Extension list */}
      <div className="flex-1 overflow-y-auto px-6 pb-6 flex flex-col gap-2 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent]">
        {activeTab === 'browse' ? (
          filteredExtensions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Package size={48} className="opacity-20 text-mute mb-4" />
              <p className="m-0 text-sm font-medium text-body">{t('empty.noExtensions')}</p>
              {searchQuery && (
                <p className="text-xs text-mute mt-1">{t('empty.tryDifferent')}</p>
              )}
            </div>
          ) : (
            filteredExtensions.map((ext) => (
              <ExtensionCard
                key={ext.manifest.id}
                extension={ext}
                installed={isInstalled(ext.manifest.id)}
                installing={installingIds.has(ext.manifest.id)}
                uninstalling={uninstallingIds.has(ext.manifest.id)}
                onInstall={() => {
                  void handleInstall(ext);
                }}
                onUninstall={() => {
                  void handleUninstall(ext.manifest.id);
                }}
              />
            ))
          )
        ) : (
          <>
            {/* Link Dev Extension button */}
            <div className="mb-4">
              <button
                className="flex items-center justify-center gap-2 w-full px-3 py-3 bg-transparent border border-dashed border-accent-blue/30 rounded-md text-accent-blue text-sm font-medium cursor-pointer transition-colors hover:bg-accent-blue-soft hover:border-accent-blue disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => {
                  void handleLinkDevExtension();
                }}
                disabled={linkingDev}
              >
                {linkingDev ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    {t('dev.linking')}
                  </>
                ) : (
                  <>
                    <FolderOpen size={16} />
                    {t('dev.linkButton')}
                  </>
                )}
              </button>
            </div>

            {/* Dev Extensions */}
            {filteredDevExtensions.length > 0 && (
              <div className="mb-6">
                <h4 className="flex items-center gap-2 m-0 mb-3 pb-2 border-b border-hairline text-[11px] font-semibold text-mute uppercase tracking-wide">
                  <Code size={16} />
                  {t('dev.sectionTitle')} ({filteredDevExtensions.length})
                </h4>
                {filteredDevExtensions.map((ext) => (
                  <DevExtensionCard
                    key={ext.manifest.id}
                    extension={ext}
                    onToggle={(enabled) => {
                      void handleToggleDevExtension(ext.manifest.id, enabled);
                    }}
                    onUnlink={() => {
                      void handleUnlinkDevExtension(ext.manifest.id);
                    }}
                    onRefresh={() => {
                      void handleRefreshDevExtension(ext.manifest.id);
                    }}
                  />
                ))}
              </div>
            )}

            {/* Installed Extensions */}
            {filteredInstalled.length > 0 && (
              <div className="mb-2">
                {filteredDevExtensions.length > 0 && (
                  <h4 className="flex items-center gap-2 m-0 mb-3 pb-2 border-b border-hairline text-[11px] font-semibold text-mute uppercase tracking-wide">
                    <Package size={16} />
                    {t('sections.installed')} ({filteredInstalled.length})
                  </h4>
                )}
                {filteredInstalled.map((ext) => (
                  <InstalledExtensionCard
                    key={ext.manifest.id}
                    extension={ext}
                    uninstalling={uninstallingIds.has(ext.manifest.id)}
                    onToggle={(enabled) => {
                      void handleToggle(ext.manifest.id, enabled);
                    }}
                    onUninstall={() => {
                      void handleUninstall(ext.manifest.id);
                    }}
                  />
                ))}
              </div>
            )}

            {/* Empty state when no extensions */}
            {filteredInstalled.length === 0 && filteredDevExtensions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Package size={48} className="opacity-20 text-mute mb-4" />
                <p className="m-0 text-sm font-medium text-body">{t('empty.noneInstalled')}</p>
                <p className="text-xs text-mute mt-1">{t('empty.browseOrLink')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Extension card for browse tab
interface ExtensionCardProps {
  extension: ExtensionInfo;
  installed: boolean;
  installing: boolean;
  uninstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

function ExtensionCard({
  extension,
  installed,
  installing,
  uninstalling,
  onInstall,
  onUninstall,
}: ExtensionCardProps): React.JSX.Element {
  const { t } = useTranslation('extensions');
  const { manifest } = extension;

  return (
    <div className="flex items-start gap-3 px-4 py-3 bg-white/[0.03] rounded-lg transition-colors hover:bg-white/[0.05]">
      {/* Icon */}
      <div className="shrink-0 w-10 h-10 flex items-center justify-center bg-white/[0.06] rounded-md text-mute">
        {(manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]) ? (
          <img src={manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]} alt={manifest.name} className="w-6 h-6 object-contain" />
        ) : (
          <Package size={32} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="m-0 text-sm font-medium text-on-dark">{manifest.name}</h3>
          <span className="text-[11px] text-mute font-mono">v{manifest.version}</span>
          {extension.verified && (
            <span className="inline-flex items-center justify-center text-accent-green" title="Verified by Volt team">
              <Shield size={14} />
            </span>
          )}
          {extension.featured && (
            <span className="inline-flex items-center justify-center text-yellow-400" title="Featured">
              <Star size={14} />
            </span>
          )}
        </div>

        <p className="m-0 text-xs text-mute line-clamp-2 leading-snug">{manifest.description}</p>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute mt-0.5">
          <span className="font-medium">by {manifest.author.name}</span>
          {manifest.category && (
            <span className="px-1.5 py-0.5 bg-white/[0.06] rounded-xs capitalize">
              {manifest.category}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Download size={12} /> {extension.downloads.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {installed ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-accent-green-soft text-accent-green rounded-sm text-[11px] font-medium">
            <CheckCircle size={14} />
            {t('actions.installed')}
          </span>
        ) : (
          <button
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-accent-blue text-white border-0 rounded-sm text-xs font-medium cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                {t('actions.installing')}
              </>
            ) : (
              <>
                <Download size={16} />
                {t('actions.install')}
              </>
            )}
          </button>
        )}

        <div className="flex gap-1">
          {installed && (
            <button
              className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer transition-colors hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={onUninstall}
              disabled={uninstalling}
              title="Uninstall"
            >
              {uninstalling ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
            </button>
          )}
          {manifest.repository && (
            <a
              href={manifest.repository}
              target="_blank"
              rel="noopener noreferrer"
              className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent text-mute no-underline transition-colors hover:bg-white/10 hover:text-on-dark"
              title="View source"
            >
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// Installed extension card
interface InstalledExtensionCardProps {
  extension: InstalledExtension;
  uninstalling: boolean;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
}

function InstalledExtensionCard({
  extension,
  uninstalling,
  onToggle,
  onUninstall,
}: InstalledExtensionCardProps): React.JSX.Element {
  const { t } = useTranslation('extensions');
  const { manifest, enabled, installedAt } = extension;

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 bg-white/[0.03] rounded-lg transition-colors hover:bg-white/[0.05]',
        !enabled && 'opacity-50'
      )}
    >
      {/* Icon */}
      <div className="shrink-0 w-10 h-10 flex items-center justify-center bg-white/[0.06] rounded-md text-mute">
        {(manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]) ? (
          <img src={manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]} alt={manifest.name} className="w-6 h-6 object-contain" />
        ) : (
          <Package size={32} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="m-0 text-sm font-medium text-on-dark">{manifest.name}</h3>
          <span className="text-[11px] text-mute font-mono">v{manifest.version}</span>
        </div>

        <p className="m-0 text-xs text-mute line-clamp-2 leading-snug">{manifest.description}</p>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute mt-0.5">
          <span className="font-medium">by {manifest.author.name}</span>
          <span>Installed {new Date(installedAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          className={cn(
            'w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 cursor-pointer transition-colors',
            enabled
              ? 'text-accent-blue hover:bg-accent-blue-soft'
              : 'text-mute hover:bg-white/10 hover:text-body'
          )}
          onClick={() => onToggle(!enabled)}
          title={enabled ? t('actions.disable') : t('actions.enable')}
        >
          {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
        </button>

        <button
          className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer transition-colors hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onUninstall}
          disabled={uninstalling}
          title={t('actions.uninstall')}
        >
          {uninstalling ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
        </button>
      </div>
    </div>
  );
}

// Dev extension card with DEV badge
interface DevExtensionCardProps {
  extension: DevExtension;
  onToggle: (enabled: boolean) => void;
  onUnlink: () => void;
  onRefresh: () => void;
}

function DevExtensionCard({
  extension,
  onToggle,
  onUnlink,
  onRefresh,
}: DevExtensionCardProps): React.JSX.Element {
  const { t } = useTranslation('extensions');
  const { manifest, enabled, path } = extension;

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 border border-dashed border-accent-blue/30 bg-accent-blue/[0.03] rounded-lg transition-colors hover:bg-accent-blue/[0.06] hover:border-accent-blue/40',
        !enabled && 'opacity-50'
      )}
    >
      {/* Icon */}
      <div className="shrink-0 w-10 h-10 flex items-center justify-center bg-accent-blue/10 rounded-md text-accent-blue">
        {(manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]) ? (
          <img src={manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]} alt={manifest.name} className="w-6 h-6 object-contain" />
        ) : (
          <Code size={32} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="m-0 text-sm font-medium text-on-dark">{manifest.name}</h3>
          <span className="text-[11px] text-mute font-mono">v{manifest.version}</span>
          <span className="bg-accent-blue-soft text-accent-blue px-1.5 py-0.5 rounded-xs text-[10px] font-semibold uppercase">
            {t('dev.badge')}
          </span>
        </div>

        <p className="m-0 text-xs text-mute line-clamp-2 leading-snug">{manifest.description}</p>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute mt-0.5">
          <span className="font-medium">by {manifest.author.name}</span>
          <span
            className="font-mono text-[10px] px-1.5 py-0.5 bg-white/[0.06] rounded-xs max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap"
            title={path}
          >
            {path.length > 40 ? '...' + path.slice(-37) : path}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          className={cn(
            'w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 cursor-pointer transition-colors',
            enabled
              ? 'text-accent-blue hover:bg-accent-blue-soft'
              : 'text-mute hover:bg-white/10 hover:text-body'
          )}
          onClick={() => onToggle(!enabled)}
          title={enabled ? t('actions.disable') : t('actions.enable')}
        >
          {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
        </button>

        <button
          className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer transition-colors hover:bg-white/10 hover:text-on-dark"
          onClick={onRefresh}
          title="Refresh from disk"
        >
          <RefreshCw size={16} />
        </button>

        <button
          className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer transition-colors hover:bg-red-500/15 hover:text-red-400"
          onClick={onUnlink}
          title="Unlink"
        >
          <Unlink size={16} />
        </button>
      </div>
    </div>
  );
}

export default ExtensionsStore;
