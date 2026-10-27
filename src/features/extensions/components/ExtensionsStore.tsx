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
  FolderOpen,
  Unlink,
  Code,
  Settings,
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
import { logger } from '../../../shared/utils/logger';
import { extensionService } from '../services/extensionService';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import type {
  DevExtension,
  ExtensionInfo,
  InstalledExtension,
  ExtensionCategory,
  ExtensionManifest,
  ExtensionPreference,
} from '../types/extension.types';
import { EXTENSION_CATEGORIES } from '../types/extension.types';
import { isVersionAtLeast } from '../utils/version';
import { Button } from '@/shared/components/ui/button';
import { Card } from '@/shared/components/ui/card';
import { Input } from '@/shared/components/ui/input';
import { Switch } from '@/shared/components/ui/switch';
import { Field, FieldDescription, FieldLabel } from '@/shared/components/ui/field';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/shared/components/ui/input-group';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { SettingsSelect } from '../../settings/components/SettingsChrome';

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
  embedded?: boolean;
}

export function ExtensionsStore({ embedded = false }: ExtensionsStoreProps): React.JSX.Element {
  const { t } = useTranslation('extensions');
  const [availableExtensions, setAvailableExtensions] = useState<ExtensionInfo[]>([]);
  const [installedExtensions, setInstalledExtensions] = useState<InstalledExtension[]>([]);
  const [devExtensions, setDevExtensions] = useState<DevExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadFailures, setLoadFailures] = useState({ browse: false, installed: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExtensionCategory | 'all'>('all');
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const [uninstallingIds, setUninstallingIds] = useState<Set<string>>(new Set());
  const [linkingDev, setLinkingDev] = useState(false);
  const [activeTab, setActiveTab] = useState<'browse' | 'installed'>('browse');
  const [appVersion, setAppVersion] = useState('0.0.0');

  const loadExtensions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [registryResult, installedResult, devResult, countsResult, versionResult] =
        await Promise.allSettled([
          extensionService.fetchRegistry({ throwOnFailure: true }),
          extensionService.getInstalledExtensions(),
          extensionService.getDevExtensions(),
          extensionService.fetchDownloadCounts(),
          getVersion(),
        ]);
      const registryReady =
        registryResult.status === 'fulfilled' && Array.isArray(registryResult.value?.extensions);
      const installedReady =
        installedResult.status === 'fulfilled' && Array.isArray(installedResult.value);
      const devReady = devResult.status === 'fulfilled' && Array.isArray(devResult.value);
      const downloadCounts = countsResult.status === 'fulfilled' ? (countsResult.value ?? {}) : {};

      if (registryReady && registryResult.status === 'fulfilled') {
        setAvailableExtensions(
          registryResult.value.extensions.map((extension) => {
            const live = downloadCounts[extension.manifest.id];
            return live !== undefined ? { ...extension, downloads: live } : extension;
          })
        );
      }
      if (installedReady && installedResult.status === 'fulfilled')
        setInstalledExtensions(installedResult.value);
      if (devReady && devResult.status === 'fulfilled') setDevExtensions(devResult.value);
      if (versionResult.status === 'fulfilled') setAppVersion(versionResult.value);
      setLoadFailures({ browse: !registryReady, installed: !installedReady || !devReady });
    } catch (err) {
      logger.error('Failed to load extensions:', err);
      setLoadFailures({ browse: true, installed: true });
    } finally {
      setLoading(false);
    }
  }, []);

  // Load extensions on mount
  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

  const handleInstall = useCallback(
    async (extension: ExtensionInfo) => {
      const extensionId = extension.manifest.id;
      setInstallingIds((prev) => new Set(prev).add(extensionId));

      try {
        const installed = await extensionService.installExtension(
          extensionId,
          extension.downloadUrl
        );
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
        setError(t('errors.install', { name: extension.manifest.name }));
      } finally {
        setInstallingIds((prev) => {
          const next = new Set(prev);
          next.delete(extensionId);
          return next;
        });
      }
    },
    [t]
  );

  const handleUninstall = useCallback(
    async (extensionId: string) => {
      setUninstallingIds((prev) => new Set(prev).add(extensionId));

      try {
        // Unload the extension first
        await notifyMainWindowToReloadExtensions('unload', extensionId);

        await extensionService.uninstallExtension(extensionId);
        setInstalledExtensions((prev) => prev.filter((e) => e.manifest.id !== extensionId));
      } catch (err) {
        logger.error('Failed to uninstall extension:', err);
        setError(t('errors.uninstall'));
      } finally {
        setUninstallingIds((prev) => {
          const next = new Set(prev);
          next.delete(extensionId);
          return next;
        });
      }
    },
    [t]
  );

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
        title: t('dev.selectFolder'),
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
      setError(t('errors.link'));
    } finally {
      setLinkingDev(false);
    }
  }, [t]);

  const handleUnlinkDevExtension = useCallback(
    async (extensionId: string) => {
      try {
        // Unload the extension first
        await notifyMainWindowToReloadExtensions('unload', extensionId);

        await extensionService.unlinkDevExtension(extensionId);
        setDevExtensions((prev) => prev.filter((e) => e.manifest.id !== extensionId));
      } catch (err) {
        logger.error('Failed to unlink dev extension:', err);
        setError(t('errors.unlink'));
      }
    },
    [t]
  );

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

  const activeLoadFailed = loadFailures[activeTab];
  const refreshButton = (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        void loadExtensions();
      }}
      title={t('header.refresh')}
      aria-label={t('header.refresh')}
    >
      <RefreshCw size={18} />
    </Button>
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-body">
        <Loader2 className="animate-spin" size={32} />
        <p className="text-sm font-medium">{t('loading')}</p>
      </div>
    );
  }

  return (
    <div className={embedded ? 'settings-page' : 'flex flex-col h-full overflow-hidden'}>
      {/* Header */}
      {!embedded && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline shrink-0">
          <h2 className="flex items-center gap-2.5 m-0 text-lg font-semibold text-on-dark">
            <Package size={24} className="text-accent-blue" />
            {t('header.title')}
          </h2>
          {refreshButton}
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1">
        <div className="py-5">
          {activeLoadFailed && (
            <div
              role="alert"
              className="mx-6 my-4 flex flex-wrap items-center gap-3 rounded-lg border border-accent-red/30 bg-accent-red/5 p-4 text-sm"
            >
              <AlertCircle size={18} className="shrink-0 text-accent-red" />
              <div className="min-w-0 flex-1">
                <strong className="block font-medium text-ink">
                  {t(activeTab === 'browse' ? 'errors.registryTitle' : 'errors.installedTitle')}
                </strong>
                <p className="mb-0 mt-1 text-xs text-mute">{t('errors.loadDescription')}</p>
              </div>
              <Button variant="ghost" size="sm" type="button" onClick={() => void loadExtensions()}>
                {t('actions.retry')}
              </Button>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2.5 px-3.5 py-2.5 mx-6 mb-4 bg-accent-red-soft border border-red-500/20 rounded-md text-accent-red text-sm"
            >
              <AlertCircle size={18} className="shrink-0" />
              <span className="flex-1">{error}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('actions.dismissError')}
                onClick={() => setError(null)}
              >
                ×
              </Button>
            </div>
          )}

          {/* Tabs */}
          <div className="flex items-center gap-1 px-6 my-4">
            <Button
              variant={activeTab === 'browse' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={activeTab === 'browse'}
              onClick={() => setActiveTab('browse')}
            >
              {t('tabs.browse')} (
              {loadFailures.browse && availableExtensions.length === 0
                ? '—'
                : availableExtensions.length}
              )
            </Button>
            <Button
              variant={activeTab === 'installed' ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={activeTab === 'installed'}
              onClick={() => setActiveTab('installed')}
            >
              {t('tabs.installed')} (
              {loadFailures.installed && totalInstalledCount === 0 ? '—' : totalInstalledCount})
            </Button>
            {embedded && <div className="ml-auto">{refreshButton}</div>}
          </div>

          {/* Search and filters */}
          <div className="flex flex-col gap-3 px-6 mb-4">
            <InputGroup>
              <InputGroupAddon>
                <Search className="size-4" />
              </InputGroupAddon>
              <InputGroupInput
                type="search"
                aria-label={t('searchPlaceholder')}
                placeholder={t('searchPlaceholder')}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </InputGroup>

            {activeTab === 'browse' && (
              <div className="flex flex-wrap gap-1.5">
                {EXTENSION_CATEGORIES.map((cat) => {
                  const IconComponent = cat.icon;
                  return (
                    <Button
                      variant={categoryFilter === cat.id ? 'secondary' : 'ghost'}
                      size="sm"
                      key={cat.id}
                      aria-pressed={categoryFilter === cat.id}
                      onClick={() => setCategoryFilter(cat.id)}
                    >
                      <IconComponent size={14} className="shrink-0" />
                      <span>{t(`categories.${cat.id}`)}</span>
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Extension list */}
          <div className="flex flex-col gap-3 px-6 pb-2">
            {activeTab === 'browse' ? (
              filteredExtensions.length === 0 &&
              loadFailures.browse ? null : filteredExtensions.length === 0 ? (
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
                    appVersion={appVersion}
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
                  <Button
                    variant="default"
                    size="sm"
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
                  </Button>
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
                {!loadFailures.installed &&
                  filteredInstalled.length === 0 &&
                  filteredDevExtensions.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <Package size={48} className="opacity-20 text-mute mb-4" />
                      <p className="m-0 text-sm font-medium text-body">
                        {t('empty.noneInstalled')}
                      </p>
                      <p className="text-xs text-mute mt-1">{t('empty.browseOrLink')}</p>
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// Extension card for browse tab
interface ExtensionCardProps {
  extension: ExtensionInfo;
  appVersion: string;
  installed: boolean;
  installing: boolean;
  uninstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

function ExtensionCard({
  extension,
  appVersion,
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
  const compatible =
    !manifest.minVoltVersion || isVersionAtLeast(appVersion, manifest.minVoltVersion);

  return (
    <>
      {showScreenshots && hasScreenshots && (
        <ScreenshotsModal
          name={manifest.name}
          screenshots={extension.screenshots!}
          onClose={() => setShowScreenshots(false)}
        />
      )}
      <Card className="flex-row flex-wrap items-start gap-3 p-4">
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 flex items-center justify-center bg-white/[0.06] rounded-md text-mute">
          {manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id] ? (
            <img
              src={manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]}
              alt={manifest.name}
              className="w-6 h-6 object-contain"
            />
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
              <span
                className="inline-flex items-center justify-center text-accent-green"
                title="Verified by Volt team"
              >
                <Shield size={14} />
              </span>
            )}
            {extension.featured && (
              <span
                className="inline-flex items-center justify-center text-yellow-400"
                title="Featured"
              >
                <Star size={14} />
              </span>
            )}
            {manifest.minVoltVersion && (
              <span
                className={cn(
                  'px-1.5 py-0.5 rounded-xs text-[10px]',
                  compatible ? 'bg-white/[0.06] text-mute' : 'bg-amber-500/15 text-amber-300'
                )}
              >
                Volt {manifest.minVoltVersion}+
              </span>
            )}
          </div>

          <p className="m-0 text-xs text-mute line-clamp-2 leading-snug">{manifest.description}</p>

          {hasScreenshots && (
            <div className="flex gap-1.5 mt-1.5">
              {extension.screenshots!.slice(0, 3).map((src, i) => (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto overflow-hidden p-0"
                  key={i}
                  onClick={() => setShowScreenshots(true)}
                  title="Preview screenshots"
                >
                  <img
                    src={src}
                    alt=""
                    className="h-10 w-16 object-cover rounded-sm border border-white/10"
                  />
                </Button>
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
            <Button
              variant="default"
              size="sm"
              onClick={onInstall}
              disabled={installing || !compatible}
              title={
                compatible
                  ? t('actions.install')
                  : `Requires Volt ${manifest.minVoltVersion} or newer (current: ${appVersion})`
              }
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
            </Button>
          )}

          <div className="flex gap-1">
            {installed && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                onClick={onUninstall}
                disabled={uninstalling}
                title="Uninstall"
              >
                {uninstalling ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Trash2 size={16} />
                )}
              </Button>
            )}
            {hasScreenshots && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowScreenshots(true)}
                title={`Preview screenshots (${extension.screenshots!.length})`}
              >
                <Images size={16} />
              </Button>
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
      </Card>
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
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [manifest.id]);

  return (
    <>
      {showPrefs && (
        <ExtensionPreferencesDialog manifest={manifest} onClose={() => setShowPrefs(false)} />
      )}
      <Card className={cn('flex-row flex-wrap items-start gap-3 p-4', !enabled && 'opacity-60')}>
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 flex items-center justify-center bg-white/[0.06] rounded-md text-mute">
          {manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id] ? (
            <img
              src={manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]}
              alt={manifest.name}
              className="w-6 h-6 object-contain"
            />
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setShowErrors((v) => !v)}
                >
                  <Bug size={10} />
                  {capturedErrors.length} error{capturedErrors.length !== 1 ? 's' : ''}
                </Button>
                {showErrors && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCapturedErrors([]);
                      setShowErrors(false);
                    }}
                  >
                    clear
                  </Button>
                )}
              </div>
              {showErrors && (
                <div className="p-2 bg-black/20 rounded-md border border-red-500/15 text-[10px] font-mono space-y-1.5 max-h-28 overflow-y-auto">
                  {capturedErrors.map((err, i) => (
                    <div key={i} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={cn(
                            'px-1 py-0.5 rounded-xs font-semibold uppercase',
                            err.severity === 'error'
                              ? 'text-red-400 bg-red-500/10'
                              : 'text-yellow-400 bg-yellow-500/10'
                          )}
                        >
                          {err.severity}
                        </span>
                        <span className="text-mute">{err.phase}</span>
                        {err.count > 1 && <span className="text-mute/70">×{err.count}</span>}
                        {err.queryContext && (
                          <span className="text-mute/70 italic truncate max-w-[80px]">
                            &quot;{err.queryContext}&quot;
                          </span>
                        )}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPrefs(true)}
              title="Configure preferences"
            >
              <Settings size={16} />
            </Button>
          )}

          <Switch checked={enabled} onCheckedChange={onToggle} aria-label={manifest.name} />

          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={onUninstall}
            disabled={uninstalling}
            title={t('actions.uninstall')}
          >
            {uninstalling ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
          </Button>
        </div>
      </Card>
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
        const ts = await invoke<number | null>('get_dev_reload_signal', {
          extensionId: manifest.id,
        });
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
    const interval = setInterval(() => {
      void poll();
    }, 1500);
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
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [manifest.id]);

  return (
    <>
      {showPrefs && (
        <ExtensionPreferencesDialog manifest={manifest} onClose={() => setShowPrefs(false)} />
      )}
      <div
        className={cn(
          'flex items-start gap-3 px-4 py-3 border border-dashed border-accent-blue/30 bg-accent-blue/[0.03] rounded-lg transition-colors hover:bg-accent-blue/[0.06] hover:border-accent-blue/40',
          !enabled && 'opacity-50'
        )}
      >
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 flex items-center justify-center bg-accent-blue/10 rounded-md text-accent-blue">
          {manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id] ? (
            <img
              src={manifest.icon || LOCAL_EXTENSION_ICONS[manifest.id]}
              alt={manifest.name}
              className="w-6 h-6 object-contain"
            />
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setShowErrors((v) => !v)}
                >
                  <Bug size={10} />
                  {capturedErrors.length} error{capturedErrors.length !== 1 ? 's' : ''}
                </Button>
                {showErrors && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCapturedErrors([]);
                      setShowErrors(false);
                    }}
                  >
                    clear
                  </Button>
                )}
              </div>
              {showErrors && (
                <div className="p-2 bg-black/20 rounded-md border border-red-500/15 text-[10px] font-mono space-y-1.5 max-h-28 overflow-y-auto">
                  {capturedErrors.map((err, i) => (
                    <div key={i} className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={cn(
                            'px-1 py-0.5 rounded-xs font-semibold uppercase',
                            err.severity === 'error'
                              ? 'text-red-400 bg-red-500/10'
                              : 'text-yellow-400 bg-yellow-500/10'
                          )}
                        >
                          {err.severity}
                        </span>
                        <span className="text-mute">{err.phase}</span>
                        {err.count > 1 && <span className="text-mute/70">×{err.count}</span>}
                        {err.queryContext && (
                          <span className="text-mute/70 italic truncate max-w-[80px]">
                            &quot;{err.queryContext}&quot;
                          </span>
                        )}
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPrefs(true)}
              title="Configure preferences"
            >
              <Settings size={16} />
            </Button>
          )}

          <Switch checked={enabled} onCheckedChange={onToggle} aria-label={manifest.name} />

          <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh from disk">
            <RefreshCw size={16} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={onUnlink}
            title="Unlink"
          >
            <Unlink size={16} />
          </Button>
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

function ScreenshotsModal({
  name,
  screenshots,
  onClose,
}: ScreenshotsModalProps): React.JSX.Element {
  const [idx, setIdx] = useState(0);
  const { t } = useTranslation('extensions');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] sm:max-w-3xl"
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') setIdx((index) => (index + 1) % screenshots.length);
          if (event.key === 'ArrowLeft')
            setIdx((index) => (index - 1 + screenshots.length) % screenshots.length);
        }}
      >
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription>
            {idx + 1} / {screenshots.length}
          </DialogDescription>
        </DialogHeader>
        <img
          src={screenshots[idx]}
          alt={`${name} ${idx + 1}`}
          className="max-h-[60dvh] w-full rounded-lg object-contain"
        />
        <DialogFooter className="justify-between">
          {screenshots.length > 1 && (
            <div className="mr-auto flex gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label={t('preferences.previousImage')}
                onClick={() =>
                  setIdx((index) => (index - 1 + screenshots.length) % screenshots.length)
                }
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label={t('preferences.nextImage')}
                onClick={() => setIdx((index) => (index + 1) % screenshots.length)}
              >
                <ChevronRight />
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={onClose}>
            {t('preferences.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const { t } = useTranslation('extensions');
  const [saveError, setSaveError] = useState(false);
  const prefs = manifest.preferences ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState(false);

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
    setSaveError(false);
    try {
      for (const pref of prefs) {
        if (pref.type === 'oauth') continue; // OAuth tokens are stored by the deep-link handler
        const val = values[pref.name] ?? '';
        if (pref.type === 'secret') {
          await invoke('set_extension_secret', {
            extensionId: manifest.id,
            key: pref.name,
            value: val,
          });
        } else {
          await invoke('set_extension_preference', {
            extensionId: manifest.id,
            key: pref.name,
            value: val,
          });
        }
      }
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 1800);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const setValue = (name: string, val: string) => setValues((prev) => ({ ...prev, [name]: val }));

  const hasNonOAuthPrefs = prefs.some((p) => p.type !== 'oauth');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t('preferences.title', { name: manifest.name })}</DialogTitle>
          <DialogDescription>{manifest.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {prefs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('preferences.empty')}</p>
          ) : (
            prefs.map((pref) =>
              pref.type === 'oauth' ? (
                <OAuthPreferenceField key={pref.name} pref={pref} extensionId={manifest.id} />
              ) : (
                <PreferenceField
                  key={pref.name}
                  pref={pref}
                  value={values[pref.name] ?? ''}
                  showSecret={showSecrets[pref.name] ?? false}
                  onToggleSecret={() =>
                    setShowSecrets((previous) => ({
                      ...previous,
                      [pref.name]: !previous[pref.name],
                    }))
                  }
                  onChange={(value) => setValue(pref.name, value)}
                  disabled={saving}
                />
              )
            )
          )}
          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {t('preferences.saveFailed')}
            </p>
          )}
        </div>
        <DialogFooter>
          {savedMsg && (
            <span role="status" className="mr-auto text-xs text-muted-foreground">
              {t('preferences.saved')}
            </span>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {hasNonOAuthPrefs ? t('preferences.cancel') : t('preferences.close')}
          </Button>
          {hasNonOAuthPrefs && (
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {t('preferences.save')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
        const hasToken = await invoke<boolean>('ext_oauth_has_token', {
          extensionId,
          provider,
        });
        setConnected(hasToken);
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
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (unlistenFn !== null) {
        unlistenFn();
        unlistenFn = null;
      }
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
          if (pendingState !== null && event.payload.state && event.payload.state !== pendingState)
            return;
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

      const { authUrl, state } = await invoke<{ authUrl: string; state: string }>(
        'ext_oauth_start',
        {
          extensionId,
          provider,
          baseAuthUrl: pref.oauthAuthUrl,
          tokenUrl: pref.oauthTokenUrl,
          clientId: pref.oauthClientId,
          scopes: pref.oauthScopes ?? [],
        }
      );

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
      {pref.description && (
        <p className="m-0 text-[11px] text-mute leading-snug">{pref.description}</p>
      )}

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
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive"
              onClick={() => {
                void handleDisconnect();
              }}
              disabled={pending}
            >
              {pending ? <Loader2 size={11} className="animate-spin" /> : <LogOut size={11} />}
              Disconnect
            </Button>
          </>
        ) : (
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              void handleConnect();
            }}
            disabled={pending}
          >
            {pending ? <Loader2 size={12} className="animate-spin" /> : <Link size={12} />}
            {pending ? 'Waiting for authorization…' : `Connect with ${provider}`}
          </Button>
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
  disabled?: boolean;
}

function PreferenceField({
  pref,
  value,
  showSecret,
  onToggleSecret,
  onChange,
  disabled,
}: PreferenceFieldProps): React.JSX.Element {
  const { t } = useTranslation('extensions');
  const id = `extension-pref-${pref.name}`;
  const label = pref.title ?? pref.name;
  return (
    <Field>
      <FieldLabel htmlFor={id}>
        {label}
        {pref.required && <span className="text-destructive">*</span>}
      </FieldLabel>
      {pref.description && <FieldDescription>{pref.description}</FieldDescription>}
      {pref.type === 'boolean' ? (
        <Switch
          id={id}
          checked={value === 'true'}
          onCheckedChange={(checked) => onChange(String(checked))}
          disabled={disabled}
        />
      ) : pref.type === 'select' && pref.options ? (
        <SettingsSelect
          id={id}
          label={label}
          value={value}
          options={[
            ...(!pref.required ? [{ value: '', label: t('preferences.select') }] : []),
            ...pref.options.map((option) => ({ value: option, label: option })),
          ]}
          onValueChange={onChange}
          disabled={disabled}
          className="w-full sm:w-full"
        />
      ) : pref.type === 'secret' ? (
        <div className="relative">
          <Input
            id={id}
            type={showSecret ? 'text' : 'password'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={pref.required ? t('preferences.required') : t('preferences.optional')}
            autoComplete="off"
            disabled={disabled}
            className="pr-10"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-1/2 -translate-y-1/2"
            onClick={onToggleSecret}
            aria-label={showSecret ? t('preferences.hideSecret') : t('preferences.showSecret')}
          >
            {showSecret ? <EyeOff /> : <Eye />}
          </Button>
        </div>
      ) : (
        <Input
          id={id}
          type={pref.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          min={pref.min}
          max={pref.max}
          placeholder={pref.required ? t('preferences.required') : t('preferences.optional')}
          disabled={disabled}
        />
      )}
    </Field>
  );
}

export default ExtensionsStore;
