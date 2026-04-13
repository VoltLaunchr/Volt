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
import { logger } from '../../../shared/utils/logger';
import { extensionService } from '../services/extensionService';
import type {
  DevExtension,
  ExtensionInfo,
  InstalledExtension,
  ExtensionCategory,
} from '../types/extension.types';
import { EXTENSION_CATEGORIES } from '../types/extension.types';
import './ExtensionsStore.css';

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
    console.log(`✓ Notified main window: ${action} ${extensionId}`);
  } catch (err) {
    console.warn('Failed to notify main window:', err);
  }
};

interface ExtensionsStoreProps {
  onRefresh?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const ExtensionsStore: React.FC<ExtensionsStoreProps> = (_props) => {
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
      const [registry, installed, devExts] = await Promise.all([
        extensionService
          .fetchRegistry()
          .catch(() => ({ extensions: [] as ExtensionInfo[], version: '0', lastUpdated: '' })),
        extensionService.getInstalledExtensions().catch(() => [] as InstalledExtension[]),
        extensionService.getDevExtensions().catch(() => [] as DevExtension[]),
      ]);

      setAvailableExtensions(registry.extensions);
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
    loadExtensions();
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
      <div className="extensions-loading">
        <Loader2 className="spin" size={32} />
        <p>{t('loading')}</p>
      </div>
    );
  }

  return (
    <div className="extensions-store">
      {/* Header */}
      <div className="extensions-header">
        <h2>
          <Package size={24} />
          {t('header.title')}
        </h2>
        <button className="refresh-btn" onClick={loadExtensions} title={t('header.refresh')}>
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div className="extensions-error">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {/* Tabs */}
      <div className="extensions-tabs">
        <button
          className={`tab ${activeTab === 'browse' ? 'active' : ''}`}
          onClick={() => setActiveTab('browse')}
        >
          {t('tabs.browse')} ({availableExtensions.length})
        </button>
        <button
          className={`tab ${activeTab === 'installed' ? 'active' : ''}`}
          onClick={() => setActiveTab('installed')}
        >
          {t('tabs.installed')} ({totalInstalledCount})
        </button>
      </div>

      {/* Search and filters */}
      <div className="extensions-filters">
        <div className="extensions-search">
          <Search size={18} />
          <input
            type="text"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {activeTab === 'browse' && (
          <div className="category-filters">
            {EXTENSION_CATEGORIES.map((cat) => {
              const IconComponent = cat.icon;
              return (
                <button
                  key={cat.id}
                  className={`category-btn ${categoryFilter === cat.id ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat.id)}
                >
                  <IconComponent size={14} className="category-icon" />
                  <span className="category-label">{cat.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Extension list */}
      <div className="extensions-list">
        {activeTab === 'browse' ? (
          filteredExtensions.length === 0 ? (
            <div className="no-extensions">
              <Package size={48} />
              <p>{t('empty.noExtensions')}</p>
              {searchQuery && <p className="hint">{t('empty.tryDifferent')}</p>}
            </div>
          ) : (
            filteredExtensions.map((ext) => (
              <ExtensionCard
                key={ext.manifest.id}
                extension={ext}
                installed={isInstalled(ext.manifest.id)}
                installing={installingIds.has(ext.manifest.id)}
                uninstalling={uninstallingIds.has(ext.manifest.id)}
                onInstall={() => handleInstall(ext)}
                onUninstall={() => handleUninstall(ext.manifest.id)}
              />
            ))
          )
        ) : (
          <>
            {/* Link Dev Extension button */}
            <div className="dev-extensions-section">
              <button
                className="btn link-dev-btn"
                onClick={handleLinkDevExtension}
                disabled={linkingDev}
              >
                {linkingDev ? (
                  <>
                    <Loader2 className="spin" size={16} />
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
              <div className="dev-extensions-list">
                <h4 className="section-title">
                  <Code size={16} />
                  {t('dev.sectionTitle')} ({filteredDevExtensions.length})
                </h4>
                {filteredDevExtensions.map((ext) => (
                  <DevExtensionCard
                    key={ext.manifest.id}
                    extension={ext}
                    onToggle={(enabled) => handleToggleDevExtension(ext.manifest.id, enabled)}
                    onUnlink={() => handleUnlinkDevExtension(ext.manifest.id)}
                    onRefresh={() => handleRefreshDevExtension(ext.manifest.id)}
                  />
                ))}
              </div>
            )}

            {/* Installed Extensions */}
            {filteredInstalled.length > 0 && (
              <div className="installed-extensions-list">
                {filteredDevExtensions.length > 0 && (
                  <h4 className="section-title">
                    <Package size={16} />
                    {t('sections.installed')} ({filteredInstalled.length})
                  </h4>
                )}
                {filteredInstalled.map((ext) => (
                  <InstalledExtensionCard
                    key={ext.manifest.id}
                    extension={ext}
                    uninstalling={uninstallingIds.has(ext.manifest.id)}
                    onToggle={(enabled) => handleToggle(ext.manifest.id, enabled)}
                    onUninstall={() => handleUninstall(ext.manifest.id)}
                  />
                ))}
              </div>
            )}

            {/* Empty state when no extensions */}
            {filteredInstalled.length === 0 && filteredDevExtensions.length === 0 && (
              <div className="no-extensions">
                <Package size={48} />
                <p>{t('empty.noneInstalled')}</p>
                <p className="hint">{t('empty.browseOrLink')}</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// Extension card for browse tab
interface ExtensionCardProps {
  extension: ExtensionInfo;
  installed: boolean;
  installing: boolean;
  uninstalling: boolean;
  onInstall: () => void;
  onUninstall: () => void;
}

const ExtensionCard: React.FC<ExtensionCardProps> = ({
  extension,
  installed,
  installing,
  uninstalling,
  onInstall,
  onUninstall,
}) => {
  const { t } = useTranslation('extensions');
  const { manifest } = extension;

  return (
    <div className="extension-card">
      <div className="extension-icon">
        {manifest.icon ? <img src={manifest.icon} alt={manifest.name} /> : <Package size={32} />}
      </div>

      <div className="extension-info">
        <div className="extension-header">
          <h3>{manifest.name}</h3>
          <span className="version">v{manifest.version}</span>
          {extension.verified && (
            <span className="badge verified" title="Verified by Volt team">
              <Shield size={14} />
            </span>
          )}
          {extension.featured && (
            <span className="badge featured" title="Featured">
              <Star size={14} />
            </span>
          )}
        </div>

        <p className="description">{manifest.description}</p>

        <div className="extension-meta">
          <span className="author">by {manifest.author.name}</span>
          {manifest.category && <span className="category">{manifest.category}</span>}
          <span className="downloads">
            <Download size={12} /> {extension.downloads.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="extension-actions">
        {installed ? (
          <span className="installed-badge">
            <CheckCircle size={14} />
            {t('actions.installed')}
          </span>
        ) : (
          <button className="btn install" onClick={onInstall} disabled={installing}>
            {installing ? (
              <>
                <Loader2 className="spin" size={16} />
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

        <div className="action-row">
          {installed && (
            <button
              className="btn uninstall"
              onClick={onUninstall}
              disabled={uninstalling}
              title="Uninstall"
            >
              {uninstalling ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            </button>
          )}
          {manifest.repository && (
            <a
              href={manifest.repository}
              target="_blank"
              rel="noopener noreferrer"
              className="btn link"
              title="View source"
            >
              <ExternalLink size={16} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

// Installed extension card
interface InstalledExtensionCardProps {
  extension: InstalledExtension;
  uninstalling: boolean;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
}

const InstalledExtensionCard: React.FC<InstalledExtensionCardProps> = ({
  extension,
  uninstalling,
  onToggle,
  onUninstall,
}) => {
  const { t } = useTranslation('extensions');
  const { manifest, enabled, installedAt } = extension;

  return (
    <div className={`extension-card installed-card ${!enabled ? 'disabled' : ''}`}>
      <div className="extension-icon">
        {manifest.icon ? <img src={manifest.icon} alt={manifest.name} /> : <Package size={32} />}
      </div>

      <div className="extension-info">
        <div className="extension-header">
          <h3>{manifest.name}</h3>
          <span className="version">v{manifest.version}</span>
        </div>

        <p className="description">{manifest.description}</p>

        <div className="extension-meta">
          <span className="author">by {manifest.author.name}</span>
          <span className="installed-date">
            Installed {new Date(installedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className="extension-actions">
        <button
          className={`btn toggle ${enabled ? 'enabled' : ''}`}
          onClick={() => onToggle(!enabled)}
          title={enabled ? t('actions.disable') : t('actions.enable')}
        >
          {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
        </button>

        <button
          className="btn uninstall"
          onClick={onUninstall}
          disabled={uninstalling}
          title={t('actions.uninstall')}
        >
          {uninstalling ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
        </button>
      </div>
    </div>
  );
};

// Dev extension card with DEV badge
interface DevExtensionCardProps {
  extension: DevExtension;
  onToggle: (enabled: boolean) => void;
  onUnlink: () => void;
  onRefresh: () => void;
}

const DevExtensionCard: React.FC<DevExtensionCardProps> = ({
  extension,
  onToggle,
  onUnlink,
  onRefresh,
}) => {
  const { t } = useTranslation('extensions');
  const { manifest, enabled, path } = extension;

  return (
    <div className={`extension-card dev-card ${!enabled ? 'disabled' : ''}`}>
      <div className="extension-icon">
        {manifest.icon ? <img src={manifest.icon} alt={manifest.name} /> : <Code size={32} />}
      </div>

      <div className="extension-info">
        <div className="extension-header">
          <h3>{manifest.name}</h3>
          <span className="version">v{manifest.version}</span>
          <span className="badge dev" title="Development Extension">
            {t('dev.badge')}
          </span>
        </div>

        <p className="description">{manifest.description}</p>

        <div className="extension-meta">
          <span className="author">by {manifest.author.name}</span>
          <span className="path" title={path}>
            {path.length > 40 ? '...' + path.slice(-37) : path}
          </span>
        </div>
      </div>

      <div className="extension-actions">
        <button
          className={`btn toggle ${enabled ? 'enabled' : ''}`}
          onClick={() => onToggle(!enabled)}
          title={enabled ? t('actions.disable') : t('actions.enable')}
        >
          {enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
        </button>

        <button className="btn refresh" onClick={onRefresh} title="Refresh from disk">
          <RefreshCw size={16} />
        </button>

        <button className="btn unlink" onClick={onUnlink} title="Unlink">
          <Unlink size={16} />
        </button>
      </div>
    </div>
  );
};

export default ExtensionsStore;
