import React, { useMemo } from 'react';
import {
  AppWindow,
  Calculator,
  Clock,
  File,
  FolderOpen,
  Gamepad2,
  Search,
  Settings,
  Cpu,
  MemoryStick,
  HardDrive,
} from 'lucide-react';
import { SearchResult, SearchResultType } from '../../../shared/types/common.types';
import { highlightMatch, HighlightSegment } from '../../../shared/utils/highlightMatch';
import { useSearchStore } from '../../../stores/searchStore';
import './ResultItem.css';

// System Monitor data interface
interface SystemMonitorData {
  type: 'cpu' | 'memory' | 'disk';
  value: number;
  color?: string;
}

// Type guard to check if data is SystemMonitorData
const isSystemMonitorData = (data: unknown): data is SystemMonitorData => {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return (
    'type' in obj &&
    'value' in obj &&
    typeof obj.value === 'number' &&
    (obj.type === 'cpu' || obj.type === 'memory' || obj.type === 'disk')
  );
};

interface ResultItemProps {
  result: SearchResult;
  isSelected: boolean;
  index: number;
  onSelect: () => void;
  onLaunch: () => void;
}

/** Render a title string with highlighted matching characters */
function HighlightedText({
  segments,
}: {
  segments: HighlightSegment[];
}) {
  return (
    <>
      {segments.map((seg, i) =>
        seg.highlighted ? (
          <span key={i} className="result-highlight">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export const ResultItem: React.FC<ResultItemProps> = ({
  result,
  isSelected,
  index: _index,
  onSelect,
  onLaunch,
}) => {
  const searchQuery = useSearchStore((s) => s.searchQuery);

  const titleSegments = useMemo(
    () => highlightMatch(result.title, searchQuery),
    [result.title, searchQuery],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onLaunch();
    }
  };

  // Render custom system monitor item with progress bar
  const renderSystemMonitorIcon = () => {
    if (!isSystemMonitorData(result.data)) {
      return (
        <div className="icon-placeholder">
          <Cpu size={24} strokeWidth={2.5} className="plugin-icon systemmonitor" />
        </div>
      );
    }
    const data = result.data;
    const type = data.type;
    const color = data.color || '#10b981';

    let IconComponent = Cpu;
    if (type === 'memory') IconComponent = MemoryStick;
    if (type === 'disk') IconComponent = HardDrive;

    return (
      <div className="icon-placeholder">
        <IconComponent
          size={24}
          strokeWidth={2.5}
          className="plugin-icon systemmonitor"
          style={{ color }}
        />
      </div>
    );
  };

  const renderSystemMonitorContent = () => {
    if (!isSystemMonitorData(result.data)) {
      return (
        <div className="result-content">
          <div className="result-title truncate">{result.title}</div>
          {result.subtitle && <div className="result-subtitle truncate">{result.subtitle}</div>}
        </div>
      );
    }
    const data = result.data;

    // Parse and validate the numeric value
    const rawValue = Number(data.value);
    const value = Number.isFinite(rawValue) ? Math.min(100, Math.max(0, rawValue)) : 0;
    const color = data.color || '#10b981';

    return (
      <div className="result-content">
        <div className="result-title truncate">{result.title}</div>
        {result.subtitle && <div className="result-subtitle truncate">{result.subtitle}</div>}
        <div className="system-monitor-progress">
          <div className="system-monitor-progress-bg">
            <div
              className="system-monitor-progress-fill"
              style={{
                width: `${value}%`,
                backgroundColor: color,
              }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`result-item ${isSelected ? 'selected' : ''}`}
      onClick={onLaunch}
      onMouseEnter={onSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${result.title} - ${result.subtitle || ''}`}
    >
      <div className="result-icon">
        {result.type === SearchResultType.SystemMonitor ? (
          renderSystemMonitorIcon()
        ) : result.icon ? (
          <img src={result.icon} alt="" className="icon-image" />
        ) : (
          <div className="icon-placeholder">
            {result.type === SearchResultType.File ? (
              <File size={24} strokeWidth={2} />
            ) : result.type === SearchResultType.Application ? (
              <AppWindow size={24} strokeWidth={2} />
            ) : result.type === SearchResultType.Game ? (
              <Gamepad2 size={24} strokeWidth={2} />
            ) : result.type === SearchResultType.Calculator ? (
              // Check if this is a timezone result
              (result.data as unknown as Record<string, unknown>)?.queryType === 'timezone' ? (
                <Clock size={24} strokeWidth={2} className="plugin-icon timer" />
              ) : (
                <Calculator size={24} strokeWidth={2} className="plugin-icon calculator" />
              )
            ) : result.type === SearchResultType.WebSearch ? (
              <Search size={24} strokeWidth={2} className="plugin-icon websearch" />
            ) : result.type === SearchResultType.SystemCommand ? (
              <Settings size={24} strokeWidth={2} className="plugin-icon systemcommand" />
            ) : result.type === SearchResultType.Timer ? (
              <Clock size={24} strokeWidth={2} className="plugin-icon timer" />
            ) : (
              <FolderOpen size={24} strokeWidth={2} />
            )}
          </div>
        )}
      </div>

      {result.type === SearchResultType.SystemMonitor ? (
        renderSystemMonitorContent()
      ) : (
        <div className="result-content">
          <div className="result-title truncate">
            <HighlightedText segments={titleSegments} />
          </div>
          {result.subtitle && <div className="result-subtitle truncate">{result.subtitle}</div>}
        </div>
      )}

      {/* Show badge: explicit badge > type badge > shortcut */}
      {result.badge ? (
        <div className="result-badge">{result.badge}</div>
      ) : (
        <div className="result-badge type-badge">
          {result.type === SearchResultType.Application && 'Application'}
          {result.type === SearchResultType.File && 'File'}
          {result.type === SearchResultType.Game && 'Game'}
          {result.type === SearchResultType.SystemCommand && 'Command'}
          {result.type === SearchResultType.Calculator && 'Calculator'}
          {result.type === SearchResultType.WebSearch && 'Web Search'}
          {result.type === SearchResultType.Timer && 'Timer'}
          {result.type === SearchResultType.SystemMonitor && 'System'}
          {result.type === SearchResultType.Plugin && 'Plugin'}
        </div>
      )}
    </div>
  );
};
