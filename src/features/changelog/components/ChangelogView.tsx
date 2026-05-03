import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  Sparkles,
  Zap,
  Cpu,
  Package,
  Settings as SettingsIcon,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { logger } from '../../../shared/utils';

interface ChangelogViewProps {
  onClose: () => void;
}

// JSON data types (from changelog.json)
interface ChangelogSectionData {
  type?: string;
  title: string;
  icon: string;
  items: string[];
}

interface ChangelogFooter {
  gettingStarted: string;
  feedback: string;
  links: {
    github: string;
    releases: string;
    docs?: string;
  };
}

interface ChangelogVersionData {
  version: string;
  date: string;
  title: string;
  description: string;
  sections: ChangelogSectionData[];
  footer: ChangelogFooter;
}

interface ChangelogData {
  versions: ChangelogVersionData[];
}

// Map icon string to React component
const getIcon = (iconName: string): React.ReactNode => {
  const icons: Record<string, React.ReactNode> = {
    sparkles: <Sparkles size={18} />,
    package: <Package size={18} />,
    zap: <Zap size={18} />,
    cpu: <Cpu size={18} />,
    settings: <SettingsIcon size={18} />,
  };
  return icons[iconName] || <Sparkles size={18} />;
};

export const ChangelogView: React.FC<ChangelogViewProps> = ({ onClose }) => {
  const { t } = useTranslation('changelog');
  const [changelog, setChangelog] = useState<ChangelogVersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load changelog from JSON file
  useEffect(() => {
    const loadChangelog = async () => {
      try {
        const response = await window.fetch('/changelog.json');
        if (!response.ok) {
          throw new Error(`Failed to load changelog: ${response.status}`);
        }
        const data: ChangelogData = await response.json();
        // Get the latest version (first in array)
        if (data.versions && data.versions.length > 0) {
          setChangelog(data.versions[0]);
        } else {
          throw new Error('No changelog versions found');
        }
      } catch (err) {
        logger.error('Failed to load changelog:', err);
        setError(err instanceof Error ? err.message : 'Failed to load changelog');
      } finally {
        setLoading(false);
      }
    };

    loadChangelog();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  useEffect(() => {
    // Focus the container for keyboard events
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  // Loading state
  if (loading) {
    return (
      <div
        ref={containerRef}
        className="flex flex-col h-full bg-canvas overflow-hidden outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-mute">
          <Loader2 size={32} className="animate-spin text-accent-blue" />
          <p>{t('loading')}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !changelog) {
    return (
      <div
        ref={containerRef}
        className="flex flex-col h-full bg-canvas overflow-hidden outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-4 border-b border-hairline bg-surface relative z-[2]">
          <div className="flex justify-between items-start gap-4">
            <div className="flex items-center gap-4">
              <AlertCircle size={24} className="shrink-0 text-accent-red" />
              <div>
                <h2 className="m-0 text-2xl font-bold leading-tight text-ink">{t('error.title')}</h2>
                <p className="mt-1 text-sm text-mute">{t('error.subtitle')}</p>
              </div>
            </div>
            <button
              className="p-2 rounded-md text-mute transition-colors hover:bg-surface-elevated hover:text-ink"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          </div>
        </div>
        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          <div className="flex flex-col items-center justify-center gap-4 p-8 text-center text-mute">
            <p>{error || 'Unknown error occurred'}</p>
            <a
              href="https://github.com/VoltLaunchr/Volt/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-blue no-underline font-medium hover:underline"
            >
              {t('error.viewReleases')}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full bg-canvas overflow-hidden outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-hairline bg-surface relative z-[2]">
        <div className="flex justify-between items-start gap-4">
          <div className="flex items-center gap-4">
            <Sparkles size={24} className="shrink-0 text-accent-blue" />
            <div>
              <h2 className="m-0 text-2xl font-bold leading-tight text-ink">{t('header.title')}</h2>
              <p className="mt-1 text-sm text-mute">{t('header.subtitle')}</p>
            </div>
          </div>
          <button
            className="p-2 rounded-md text-mute transition-colors hover:bg-surface-elevated hover:text-ink"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[900px] mx-auto p-8">
          {/* Version Badge */}
          <div className="inline-flex items-center gap-3 px-4 py-1.5 rounded-full bg-surface-elevated border border-hairline mb-8">
            <span className="font-semibold text-body">v{changelog.version}</span>
            <span className="text-mute">•</span>
            <span className="text-xs text-ash">{changelog.date}</span>
          </div>

          {/* Welcome Message */}
          <div className="bg-surface border border-hairline rounded-lg p-5 mb-8">
            <h3 className="m-0 mb-2 text-xl font-semibold text-ink">{changelog.title}</h3>
            <p className="m-0 text-body leading-relaxed">{changelog.description}</p>
          </div>

          {/* Changelog Sections */}
          <div className="flex flex-col gap-4 mb-8">
            {changelog.sections.map((section, index) => (
              <div
                key={index}
                className="bg-surface border border-hairline rounded-lg p-5 transition-colors hover:bg-surface-elevated"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 flex items-center justify-center rounded-md bg-surface-elevated border border-hairline text-accent-blue shrink-0">
                    {getIcon(section.icon)}
                  </div>
                  <h4 className="m-0 text-lg font-semibold text-ink">{section.title}</h4>
                </div>
                <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
                  {section.items.map((item, itemIndex) => (
                    <li key={itemIndex} className="relative pl-4 text-body leading-relaxed before:content-['•'] before:absolute before:left-0 before:text-mute">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Footer Message */}
          {changelog.footer && (
            <div className="bg-surface border border-hairline rounded-lg p-5">
              <p className="m-0 mb-2 last:mb-0 leading-relaxed text-body">
                <strong className="text-ink">Getting Started:</strong> {changelog.footer.gettingStarted}
              </p>
              <p className="m-0 mb-2 last:mb-0 text-sm text-body leading-relaxed">
                {changelog.footer.feedback}{' '}
                <a
                  href={changelog.footer.links?.github}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-blue no-underline hover:underline"
                >
                  GitHub repository
                </a>
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="shrink-0 px-8 py-3 border-t border-hairline bg-surface relative z-[2]">
        <div className="flex justify-between items-center gap-4 text-sm">
          <span className="text-mute">
            {t('footer.pressEsc')}{' '}
            <kbd className="font-mono text-sm px-1.5 py-0.5 rounded-sm bg-surface-elevated border border-hairline text-mute">
              {t('footer.escKey')}
            </kbd>{' '}
            {t('footer.toClose')}
          </span>
          <a
            href={changelog.footer.links.releases}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue no-underline hover:underline"
          >
            {t('footer.viewAllReleases')}
          </a>
        </div>
      </div>
    </div>
  );
};
