import React from 'react';
import {
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

export const ResultItem: React.FC<ResultItemProps> = ({
  result,
  isSelected,
  index,
  onSelect,
  onLaunch,
}) => {
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
              <Gamepad2 size={24} strokeWidth={2} />
            ) : result.type === SearchResultType.Calculator ? (
              <Calculator size={24} strokeWidth={2} className="plugin-icon calculator" />
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
          <div className="result-title truncate">{result.title}</div>
          {result.subtitle && <div className="result-subtitle truncate">{result.subtitle}</div>}
        </div>
      )}

      {/* Show badge if available, otherwise show shortcut */}
      {result.badge ? (
        <div className="result-badge">{result.badge}</div>
      ) : (
        index < 9 && (
          <div className="result-shortcut">
            <kbd>Alt+{index + 1}</kbd>
          </div>
        )
      )}
    </div>
  );
};
