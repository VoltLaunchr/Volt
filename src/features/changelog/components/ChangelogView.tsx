import React, { useEffect, useState } from 'react';
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
import './ChangelogView.css';

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
  const [changelog, setChangelog] = useState<ChangelogVersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    const container = document.querySelector('.changelog-view');
    if (container instanceof HTMLElement) {
      container.focus();
    }
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="changelog-view" tabIndex={0} onKeyDown={handleKeyDown}>
        <div className="changelog-loading">
          <Loader2 size={32} className="changelog-loading-spinner" />
          <p>Loading changelog...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !changelog) {
    return (
      <div className="changelog-view" tabIndex={0} onKeyDown={handleKeyDown}>
        <div className="changelog-header">
          <div className="changelog-header-content">
            <div className="changelog-header-title">
              <AlertCircle size={24} className="changelog-header-icon error" />
              <div>
                <h2>Unable to Load Changelog</h2>
                <p className="changelog-subtitle">Something went wrong</p>
              </div>
            </div>
            <button className="changelog-close-button" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
        </div>
        <div className="changelog-content">
          <div className="changelog-error">
            <p>{error || 'Unknown error occurred'}</p>
            <a
              href="https://github.com/VoltLaunchr/Volt/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="changelog-error-link"
            >
              View releases on GitHub →
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="changelog-view" tabIndex={0} onKeyDown={handleKeyDown}>
      <div className="changelog-header">
        <div className="changelog-header-content">
          <div className="changelog-header-title">
            <Sparkles size={24} className="changelog-header-icon" />
            <div>
              <h2>What's New in Volt</h2>
              <p className="changelog-subtitle">Your productivity companion just got better</p>
            </div>
          </div>
          <button className="changelog-close-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="changelog-content">
        <div className="changelog-container">
          {/* Version Badge */}
          <div className="version-badge">
            <span className="version-number">v{changelog.version}</span>
            <span className="version-divider">•</span>
            <span className="version-date">{changelog.date}</span>
          </div>

          {/* Welcome Message */}
          <div className="welcome-section">
            <h3>{changelog.title}</h3>
            <p>{changelog.description}</p>
          </div>

          {/* Changelog Sections */}
          <div className="changelog-sections">
            {changelog.sections.map((section, index) => (
              <div key={index} className="changelog-section">
                <div className="section-header">
                  <div className="section-icon">{getIcon(section.icon)}</div>
                  <h4>{section.title}</h4>
                </div>
                <ul className="section-items">
                  {section.items.map((item, itemIndex) => (
                    <li key={itemIndex}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* Footer Message */}
          <div className="changelog-message">
            <p>
              <strong>Getting Started:</strong> {changelog.footer.gettingStarted}
            </p>
            <p className="feedback-text">
              {changelog.footer.feedback}{' '}
              <a href={changelog.footer.links.github} target="_blank" rel="noopener noreferrer">
                GitHub repository
              </a>
            </p>
          </div>
        </div>
      </div>

      <div className="changelog-footer">
        <div className="changelog-footer-content">
          <span className="changelog-footer-hint">
            Press <kbd>Esc</kbd> to close
          </span>
          <a
            href={changelog.footer.links.releases}
            target="_blank"
            rel="noopener noreferrer"
            className="changelog-footer-link"
          >
            View All Releases →
          </a>
        </div>
      </div>
    </div>
  );
};
