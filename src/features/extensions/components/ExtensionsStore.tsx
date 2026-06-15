/**
 * Extensions Store Component
 * Displays available and installed extensions with install/uninstall capabilities
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  Settings,
  X,
  Save,
  Eye,
  EyeOff,
  Images,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Link,
  Bug,
} from 'lucide-react';
import type { ExtensionError } from '../loader/worker-sandbox';
import { open } from '@tauri-apps/plugin-dialog';
import { emit, listen } from '@tauri-apps/api/event';
import { cn } from '@/lib/utils';
import { extractErrorMessage } from '../../../shared/utils/error';
import { logger } from '../../../shared/utils/logger';
import { extensionService } from '../services/extensionService';
import { invoke } from '@tauri-apps/api/core';
import type {
  DevExtension,
  ExtensionInfo,
  InstalledExtension,
  ExtensionCategory,
  ExtensionManifest,
  ExtensionPreference,
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
        extensionService.fetchDownloadCounts().catch((): Record<string, number> => ({})),
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
      setError(`Failed to install ${extension.manifest.name}: ${extractErrorMessage(err)}`);
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
      setError(`Failed to link extension: ${extractErrorMessage(err)}`);
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
  const [showScreenshots, setShowScreenshots] = useState(false);
  const hasScreenshots = (extension.screenshots?.length ?? 0) > 0;

  return (
    <>
    {showScreenshots && hasScreenshots && (
      <ScreenshotsModal
        name={manifest.name}
        screenshots={extension.screenshots!}
        onClose={() => setShowScreenshots(false)}
      />
    )}
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

        {hasScreenshots && (
          <div className="flex gap-1.5 mt-1.5">
            {extension.screenshots!.slice(0, 3).map((src, i) => (
              <button
                key={i}
                className="p-0 border-0 bg-transparent cursor-pointer rounded-sm overflow-hidden opacity-70 hover:opacity-100 transition-opacity"
                onClick={() => setShowScreenshots(true)}
                title="Preview screenshots"
              >
                <img src={src} alt="" className="h-10 w-16 object-cover rounded-sm border border-white/10" />
              </button>
            ))}
          </div>
        )}

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
          {hasScreenshots && (
            <button
              className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer transition-colors hover:bg-white/10 hover:text-on-dark"
              onClick={() => setShowScreenshots(true)}
              title={`Preview screenshots (${extension.screenshots!.length})`}
            >
              <Images size={16} />
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
    </>
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
  const [showPrefs, setShowPrefs] = useState(false);
  const hasPrefs = (manifest.preferences?.length ?? 0) > 0;
  const [capturedErrors, setCapturedErrors] = useState<ExtensionError[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ExtensionError>('ext:error-captured', ({ payload }) => {
      if (payload.extensionId !== manifest.id) return;
      setCapturedErrors((prev) => {
        const updated = [...prev];
        const existing = updated.find(
          (e) => e.message === payload.message && e.firstSeen === payload.firstSeen
        );
        if (existing) {
          existing.count = payload.count;
          existing.lastSeen = payload.lastSeen;
          return [...updated];
        }
        return [...updated.slice(-19), payload];
      });
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [manifest.id]);

  return (
    <>
    {showPrefs && <ExtensionPreferencesDialog manifest={manifest} onClose={() => setShowPrefs(false)} />}
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

        {manifest.commands && manifest.commands.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {manifest.commands.map((cmd) => (
              <span
                key={cmd.name}
                className="px-1.5 py-0.5 rounded-xs text-[10px] bg-white/[0.06] text-mute border border-white/[0.06]"
                title={cmd.description}
              >
                {cmd.title}
              </span>
            ))}
          </div>
        )}

        {capturedErrors.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowErrors((v) => !v)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/15 border border-red-500/20 transition-colors"
              >
                <Bug size={10} />
                {capturedErrors.length} error{capturedErrors.length !== 1 ? 's' : ''}
              </button>
              {showErrors && (
                <button
                  onClick={() => { setCapturedErrors([]); setShowErrors(false); }}
                  className="text-[10px] text-mute hover:text-body transition-colors"
                >
                  clear
                </button>
              )}
            </div>
            {showErrors && (
              <div className="p-2 bg-black/20 rounded-md border border-red-500/15 text-[10px] font-mono space-y-1.5 max-h-28 overflow-y-auto">
                {capturedErrors.map((err, i) => (
                  <div key={i} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn(
                        'px-1 py-0.5 rounded-xs font-semibold uppercase',
                        err.severity === 'error' ? 'text-red-400 bg-red-500/10' : 'text-yellow-400 bg-yellow-500/10'
                      )}>
                        {err.severity}
                      </span>
                      <span className="text-mute">{err.phase}</span>
                      {err.count > 1 && <span className="text-mute/70">×{err.count}</span>}
                      {err.queryContext && <span className="text-mute/70 italic truncate max-w-[80px]">&quot;{err.queryContext}&quot;</span>}
                    </div>
                    <div className="text-red-300/90 break-all">{err.message}</div>
                    {err.stack && (
                      <div className="text-mute/60 text-[9px] break-all">
                        {err.stack.split('\n').find((l) => l.trim())}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasPrefs && (
          <button
            className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer transition-colors hover:bg-white/10 hover:text-on-dark"
            onClick={() => setShowPrefs(true)}
            title="Configure preferences"
          >
            <Settings size={16} />
          </button>
        )}

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
    </>
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
  const [showPrefs, setShowPrefs] = useState(false);
  const hasPrefs = (manifest.preferences?.length ?? 0) > 0;
  const lastSignalRef = useRef<number | null>(null);
  const [hotReloading, setHotReloading] = useState(false);

  // Poll for .volt-dev-reload sentinel written by `volt-plugin dev`
  useEffect(() => {
    const poll = async () => {
      try {
        const ts = await invoke<number | null>('get_dev_reload_signal', { extensionId: manifest.id });
        if (ts !== null) {
          if (lastSignalRef.current === null) {
            lastSignalRef.current = ts;
          } else if (ts > lastSignalRef.current) {
            lastSignalRef.current = ts;
            setHotReloading(true);
            onRefresh();
            setTimeout(() => setHotReloading(false), 1200);
          }
        }
      } catch {
        // extension may not be linked yet
      }
    };
    const interval = setInterval(() => { void poll(); }, 1500);
    return () => clearInterval(interval);
  }, [manifest.id, onRefresh]);

  const [capturedErrors, setCapturedErrors] = useState<ExtensionError[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ExtensionError>('ext:error-captured', ({ payload }) => {
      if (payload.extensionId !== manifest.id) return;
      setCapturedErrors((prev) => {
        const updated = [...prev];
        const existing = updated.find(
          (e) => e.message === payload.message && e.firstSeen === payload.firstSeen
        );
        if (existing) {
          existing.count = payload.count;
          existing.lastSeen = payload.lastSeen;
          return [...updated];
        }
        return [...updated.slice(-19), payload];
      });
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [manifest.id]);

  return (
    <>
    {showPrefs && <ExtensionPreferencesDialog manifest={manifest} onClose={() => setShowPrefs(false)} />}
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
          {hotReloading && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <RefreshCw size={10} className="animate-spin" /> reloaded
            </span>
          )}
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

        {capturedErrors.length > 0 && (
          <div className="mt-1.5 flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowErrors((v) => !v)}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-xs text-[10px] font-medium bg-red-500/10 text-red-400 hover:bg-red-500/15 border border-red-500/20 transition-colors"
              >
                <Bug size={10} />
                {capturedErrors.length} error{capturedErrors.length !== 1 ? 's' : ''}
              </button>
              {showErrors && (
                <button
                  onClick={() => { setCapturedErrors([]); setShowErrors(false); }}
                  className="text-[10px] text-mute hover:text-body transition-colors"
                >
                  clear
                </button>
              )}
            </div>
            {showErrors && (
              <div className="p-2 bg-black/20 rounded-md border border-red-500/15 text-[10px] font-mono space-y-1.5 max-h-28 overflow-y-auto">
                {capturedErrors.map((err, i) => (
                  <div key={i} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn(
                        'px-1 py-0.5 rounded-xs font-semibold uppercase',
                        err.severity === 'error' ? 'text-red-400 bg-red-500/10' : 'text-yellow-400 bg-yellow-500/10'
                      )}>
                        {err.severity}
                      </span>
                      <span className="text-mute">{err.phase}</span>
                      {err.count > 1 && <span className="text-mute/70">×{err.count}</span>}
                      {err.queryContext && <span className="text-mute/70 italic truncate max-w-[80px]">&quot;{err.queryContext}&quot;</span>}
                    </div>
                    <div className="text-red-300/90 break-all">{err.message}</div>
                    {err.stack && (
                      <div className="text-mute/60 text-[9px] break-all">
                        {err.stack.split('\n').find((l) => l.trim())}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {hasPrefs && (
          <button
            className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer transition-colors hover:bg-white/10 hover:text-on-dark"
            onClick={() => setShowPrefs(true)}
            title="Configure preferences"
          >
            <Settings size={16} />
          </button>
        )}

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
    </>
  );
}

// Screenshots lightbox modal
interface ScreenshotsModalProps {
  name: string;
  screenshots: string[];
  onClose: () => void;
}

function ScreenshotsModal({ name, screenshots, onClose }: ScreenshotsModalProps): React.JSX.Element {
  const [idx, setIdx] = useState(0);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIdx((i) => (i + 1) % screenshots.length);
      if (e.key === 'ArrowLeft') setIdx((i) => (i - 1 + screenshots.length) % screenshots.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, screenshots.length]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      {/* Header */}
      <div className="flex items-center justify-between w-full max-w-3xl px-4 pb-3">
        <span className="text-xs text-mute">{name} — {idx + 1} / {screenshots.length}</span>
        <button
          className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer hover:text-on-dark hover:bg-white/10 transition-colors"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      {/* Image + nav */}
      <div className="relative flex items-center justify-center w-full max-w-3xl px-4">
        {screenshots.length > 1 && (
          <button
            className="absolute left-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 border border-white/10 text-on-dark cursor-pointer hover:bg-black/80 transition-colors"
            onClick={() => setIdx((i) => (i - 1 + screenshots.length) % screenshots.length)}
          >
            <ChevronLeft size={18} />
          </button>
        )}

        <img
          src={screenshots[idx]}
          alt={`Screenshot ${idx + 1}`}
          className="rounded-lg max-h-[60vh] max-w-full object-contain shadow-2xl border border-white/10"
        />

        {screenshots.length > 1 && (
          <button
            className="absolute right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 border border-white/10 text-on-dark cursor-pointer hover:bg-black/80 transition-colors"
            onClick={() => setIdx((i) => (i + 1) % screenshots.length)}
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      {/* Dots */}
      {screenshots.length > 1 && (
        <div className="flex gap-1.5 mt-4">
          {screenshots.map((_, i) => (
            <button
              key={i}
              className={cn(
                'w-1.5 h-1.5 rounded-full border-0 p-0 cursor-pointer transition-colors',
                i === idx ? 'bg-white' : 'bg-white/30 hover:bg-white/50'
              )}
              onClick={() => setIdx(i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Preferences dialog — auto-generates form fields from manifest.preferences[]
interface ExtensionPreferencesDialogProps {
  manifest: ExtensionManifest;
  onClose: () => void;
}

function ExtensionPreferencesDialog({
  manifest,
  onClose,
}: ExtensionPreferencesDialogProps): React.JSX.Element {
  const prefs = manifest.preferences ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Load existing values on mount (skip 'oauth' prefs — handled by OAuthPreferenceField).
  // Derive the pref list inside the effect so we depend only on the manifest's
  // own properties; the outer `prefs` reference allocates `[]` on every render.
  useEffect(() => {
    const load = async () => {
      const prefList = manifest.preferences ?? [];
      const loaded: Record<string, string> = {};
      for (const pref of prefList) {
        if (pref.type === 'oauth') continue;
        try {
          if (pref.type === 'secret') {
            const val = await invoke<string | null>('get_extension_secret', {
              extensionId: manifest.id,
              key: pref.name,
            });
            loaded[pref.name] = val ?? '';
          } else {
            const val = await invoke<string | null>('get_extension_preference', {
              extensionId: manifest.id,
              key: pref.name,
            });
            loaded[pref.name] = val ?? String(pref.default ?? '');
          }
        } catch {
          loaded[pref.name] = String(pref.default ?? '');
        }
      }
      setValues(loaded);
    };
    void load();
  }, [manifest.id, manifest.preferences]);

  const handleSave = async () => {
    setSaving(true);
    try {
      for (const pref of prefs) {
        if (pref.type === 'oauth') continue; // OAuth tokens are stored by the deep-link handler
        const val = values[pref.name] ?? '';
        if (pref.type === 'secret') {
          await invoke('set_extension_secret', { extensionId: manifest.id, key: pref.name, value: val });
        } else {
          await invoke('set_extension_preference', { extensionId: manifest.id, key: pref.name, value: val });
        }
      }
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const setValue = (name: string, val: string) => setValues(prev => ({ ...prev, [name]: val }));

  const hasNonOAuthPrefs = prefs.some((p) => p.type !== 'oauth');

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="relative w-full max-w-md bg-[var(--bg-panel,#1a1a2e)] border border-white/10 rounded-xl shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <Settings size={16} className="text-mute" />
            <h2 className="m-0 text-sm font-semibold text-on-dark">{manifest.name} — Preferences</h2>
          </div>
          <button
            className="w-7 h-7 p-0 flex items-center justify-center rounded-sm bg-transparent border-0 text-mute cursor-pointer hover:text-on-dark hover:bg-white/10 transition-colors"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-4">
          {prefs.length === 0 ? (
            <p className="text-xs text-mute text-center py-6">No preferences defined for this extension.</p>
          ) : (
            prefs.map((pref) =>
              pref.type === 'oauth' ? (
                <OAuthPreferenceField
                  key={pref.name}
                  pref={pref}
                  extensionId={manifest.id}
                />
              ) : (
                <PreferenceField
                  key={pref.name}
                  pref={pref}
                  value={values[pref.name] ?? ''}
                  showSecret={showSecrets[pref.name] ?? false}
                  onToggleSecret={() => setShowSecrets(prev => ({ ...prev, [pref.name]: !prev[pref.name] }))}
                  onChange={(val) => setValue(pref.name, val)}
                />
              )
            )
          )}
        </div>

        {/* Footer — only show Save when there are non-OAuth prefs */}
        {hasNonOAuthPrefs && (
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.08]">
            {savedMsg && <span className="text-xs text-green-400 mr-auto">Saved!</span>}
            <button
              className="px-3 py-1.5 text-xs text-mute bg-transparent border-0 cursor-pointer hover:text-on-dark transition-colors rounded-sm"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent-blue rounded-sm border-0 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => { void handleSave(); }}
              disabled={saving}
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Save
            </button>
          </div>
        )}
        {!hasNonOAuthPrefs && (
          <div className="flex items-center justify-end px-5 py-3 border-t border-white/[0.08]">
            <button
              className="px-3 py-1.5 text-xs text-mute bg-transparent border-0 cursor-pointer hover:text-on-dark transition-colors rounded-sm"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// OAuth preference field — Connect / Disconnect flow via PKCE deep-link callback
interface OAuthPreferenceFieldProps {
  pref: ExtensionPreference;
  extensionId: string;
}

function OAuthPreferenceField({ pref, extensionId }: OAuthPreferenceFieldProps): React.JSX.Element {
  const [connected, setConnected] = useState<boolean | null>(null); // null = loading
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider = pref.oauthProvider ?? pref.name;

  // Check current connection status on mount
  useEffect(() => {
    const check = async () => {
      try {
        const token = await invoke<string | null>('ext_oauth_get_token', {
          extensionId,
          provider,
        });
        setConnected(token !== null && token !== '');
      } catch {
        setConnected(false);
      }
    };
    void check();
  }, [extensionId, provider]);

  const handleConnect = async () => {
    if (!pref.oauthAuthUrl || !pref.oauthTokenUrl || !pref.oauthClientId) {
      setError('OAuth configuration incomplete in extension manifest.');
      return;
    }
    setPending(true);
    setError(null);
    let unlistenFn: (() => void) | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    let pendingState: string | null = null;

    const finish = (success: boolean, errMsg?: string) => {
      if (done) return;
      done = true;
      if (timerId !== null) { clearTimeout(timerId); timerId = null; }
      if (unlistenFn !== null) { unlistenFn(); unlistenFn = null; }
      setPending(false);
      if (success) {
        setConnected(true);
      } else {
        setError(errMsg ?? 'Authorization failed');
      }
    };

    try {
      // Register listener before opening browser to close the timing race
      unlistenFn = await listen<{ token?: string; error?: string; state?: string }>(
        `ext-oauth-${extensionId}`,
        (event) => {
          if (pendingState !== null && event.payload.state && event.payload.state !== pendingState) return;
          if (event.payload.error) {
            finish(false, event.payload.error);
          } else {
            finish(true);
          }
        }
      );

      timerId = setTimeout(
        () => finish(false, 'Authorization timed out after 5 minutes'),
        5 * 60 * 1000
      );

      const { authUrl, state } = await invoke<{ authUrl: string; state: string }>('ext_oauth_start', {
        extensionId,
        provider,
        baseAuthUrl: pref.oauthAuthUrl,
        tokenUrl: pref.oauthTokenUrl,
        clientId: pref.oauthClientId,
        scopes: pref.oauthScopes ?? [],
      });

      pendingState = state;

      // Open in default browser
      const { openUrl } = await import('@tauri-apps/plugin-opener');
      await openUrl(authUrl);
    } catch (err) {
      finish(false, String(err));
    }
  };

  const handleDisconnect = async () => {
    setPending(true);
    setError(null);
    try {
      await invoke('ext_oauth_revoke_token', { extensionId, provider });
      setConnected(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-on-dark">{pref.title ?? pref.name}</label>
        {pref.required && <span className="text-[10px] text-red-400">*</span>}
      </div>
      {pref.description && <p className="m-0 text-[11px] text-mute leading-snug">{pref.description}</p>}

      <div className="flex items-center gap-2">
        {connected === null ? (
          <span className="text-xs text-mute flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Checking…
          </span>
        ) : connected ? (
          <>
            <span className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle size={13} />
              Connected
            </span>
            <button
              className="flex items-center gap-1 px-2.5 py-1 text-xs text-mute bg-white/[0.06] border border-white/[0.1] rounded-md cursor-pointer hover:text-red-400 hover:border-red-400/30 transition-colors disabled:opacity-50"
              onClick={() => { void handleDisconnect(); }}
              disabled={pending}
            >
              {pending ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />}
              Disconnect
            </button>
          </>
        ) : (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent-blue rounded-md border-0 cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50"
            onClick={() => { void handleConnect(); }}
            disabled={pending}
          >
            {pending
              ? <Loader2 size={12} className="animate-spin" />
              : <Link size={12} />
            }
            {pending ? 'Waiting for authorization…' : `Connect with ${provider}`}
          </button>
        )}
      </div>

      {error && (
        <p className="m-0 text-[11px] text-red-400 flex items-center gap-1">
          <AlertCircle size={11} />
          {error}
        </p>
      )}
    </div>
  );
}

interface PreferenceFieldProps {
  pref: ExtensionPreference;
  value: string;
  showSecret: boolean;
  onToggleSecret: () => void;
  onChange: (val: string) => void;
}

function PreferenceField({ pref, value, showSecret, onToggleSecret, onChange }: PreferenceFieldProps): React.JSX.Element {
  const inputClass =
    'w-full px-3 py-2 text-xs text-on-dark bg-white/[0.06] border border-white/[0.1] rounded-md outline-none focus:border-accent-blue/60 transition-colors';

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-on-dark">{pref.title ?? pref.name}</label>
        {pref.required && <span className="text-[10px] text-red-400">*</span>}
      </div>
      {pref.description && <p className="m-0 text-[11px] text-mute leading-snug">{pref.description}</p>}

      {pref.type === 'boolean' ? (
        <button
          className={cn(
            'self-start flex items-center gap-2 px-3 py-1.5 text-xs rounded-md border-0 cursor-pointer transition-colors',
            value === 'true'
              ? 'bg-accent-blue/20 text-accent-blue'
              : 'bg-white/[0.06] text-mute hover:bg-white/[0.1] hover:text-on-dark'
          )}
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
        >
          {value === 'true' ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
          {value === 'true' ? 'Enabled' : 'Disabled'}
        </button>
      ) : pref.type === 'select' && pref.options ? (
        <select
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ background: 'rgba(255,255,255,0.06)', color: 'inherit' }}
        >
          {!pref.required && <option value="">— select —</option>}
          {pref.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : pref.type === 'secret' ? (
        <div className="relative">
          <input
            type={showSecret ? 'text' : 'password'}
            className={cn(inputClass, 'pr-9')}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={pref.required ? 'Required' : 'Optional'}
            autoComplete="off"
          />
          <button
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0 bg-transparent border-0 text-mute cursor-pointer hover:text-on-dark transition-colors"
            onClick={onToggleSecret}
            tabIndex={-1}
          >
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      ) : pref.type === 'number' ? (
        <input
          type="number"
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          min={pref.min}
          max={pref.max}
          placeholder={pref.required ? 'Required' : 'Optional'}
        />
      ) : (
        <input
          type="text"
          className={inputClass}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={pref.required ? 'Required' : 'Optional'}
        />
      )}
    </div>
  );
}

export default ExtensionsStore;
