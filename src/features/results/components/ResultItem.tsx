import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Calculator,
  Clock,
  Copy,
  Equal,
  File,
  FolderOpen,
  Gamepad2,
  Loader2,
  Search,
  Settings,
  Terminal,
  Cpu,
  MemoryStick,
  HardDrive,
} from 'lucide-react';
import { SearchResult, SearchResultType } from '../../../shared/types/common.types';
import type { ShellOutputData } from '../../plugins/builtin/shell';
import { stripAnsi } from '../../plugins/builtin/shell';
import { AnsiText } from '../../plugins/builtin/shell/ansiParser';
import { highlightMatch, HighlightSegment } from '../../../shared/utils/highlightMatch';
import { useSearchStore } from '../../../stores/searchStore';
import './ResultItem.css';

// Calculator data interface - nested inside PluginResult.data
interface CalculatorInnerData {
  queryType: 'math' | 'unit' | 'date' | 'timezone';
  expression?: string;
  formatted?: string;
  result?: number;
}

/** Extract calculator-specific data from the SearchResult data (which is the full PluginResult) */
const getCalculatorData = (data: unknown): CalculatorInnerData | null => {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  // data is a PluginResult; calculator fields are in obj.data
  const inner = obj.data as Record<string, unknown> | undefined;
  if (!inner || typeof inner !== 'object') return null;
  if ('queryType' in inner && typeof inner.queryType === 'string') {
    return inner as unknown as CalculatorInnerData;
  }
  return null;
};

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
        <div
          className="system-monitor-progress"
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${result.title}: ${value}%`}
        >
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

  // Shell command output state — updated via DOM events from the plugin
  const isShellCommand = result.type === SearchResultType.ShellCommand;
  const initialData = isShellCommand ? (result.data as unknown as ShellOutputData) : null;
  const [shellData, setShellData] = useState<ShellOutputData | null>(initialData);

  useEffect(() => {
    if (!isShellCommand) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { command: string; data: ShellOutputData };
      if (detail.command === (result.data as unknown as ShellOutputData)?.command) {
        setShellData({ ...detail.data });
      }
    };
    window.addEventListener('volt:shell-output', handler);
    return () => window.removeEventListener('volt:shell-output', handler);
  }, [isShellCommand, result.data]);

  const handleCopyOutput = useCallback((text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
  }, []);

  const calcData = result.type === SearchResultType.Calculator
    ? getCalculatorData(result.data)
    : null;

  const renderCalculatorContent = () => {
    if (!calcData || !calcData.expression || !calcData.formatted) {
      return (
        <div className="result-content">
          <div className="result-title truncate">{result.title}</div>
          {result.subtitle && <div className="result-subtitle truncate">{result.subtitle}</div>}
        </div>
      );
    }

    return (
      <div className="result-content calculator-card-content">
        <div className="calculator-card">
          <div className="calculator-card-expression">
            <span className="calculator-card-value">{calcData.expression}</span>
            <span className="calculator-card-label">Expression</span>
          </div>
          <div className="calculator-card-separator">
            <Equal size={16} strokeWidth={2.5} />
          </div>
          <div className="calculator-card-result">
            <span className="calculator-card-value">{calcData.formatted}</span>
            <span className="calculator-card-label">Result</span>
          </div>
        </div>
      </div>
    );
  };

  const renderShellContent = () => {
    const data = shellData || initialData;
    if (!data) return null;

    if (data.status === 'pending') {
      return (
        <div className="result-content">
          <div className="result-title shell-command-title">
            {data.command ? `> ${data.command}` : 'Shell Command Mode'}
          </div>
          <div className="result-subtitle truncate">
            {data.command ? 'Press Enter to run' : 'Type a command after > (e.g. >git status)'}
          </div>
        </div>
      );
    }

    if (data.status === 'running') {
      const partialStdout = data.stdout?.trim();
      const partialStderr = data.stderr?.trim();
      const hasPartialOutput = partialStdout || partialStderr;
      return (
        <div className="result-content">
          <div className="result-title shell-command-title">{`> ${data.command}`}</div>
          <div className="shell-output-block shell-loading">
            <Loader2 size={14} className="shell-spinner" />
            <span>Running... (Ctrl+C to cancel)</span>
          </div>
          {hasPartialOutput && (
            <pre className="shell-output-block">
              {partialStdout && <AnsiText text={partialStdout} />}
              {partialStderr && <span className="shell-stderr"><AnsiText text={partialStderr} /></span>}
            </pre>
          )}
        </div>
      );
    }

    if (data.status === 'error') {
      return (
        <div className="result-content">
          <div className="result-title shell-command-title">{`> ${data.command}`}</div>
          <div className="shell-output-block shell-error">
            {data.errorMessage || 'Command failed'}
          </div>
        </div>
      );
    }

    // status === 'done'
    const output = data.stdout || '';
    const stderr = data.stderr || '';
    const hasOutput = output.trim() || stderr.trim();

    return (
      <div className="result-content">
        <div className="shell-output-header">
          <span className="result-title shell-command-title">{`> ${data.command}`}</span>
          <span className="shell-meta">
            {data.timedOut && <span className="shell-timeout">timed out</span>}
            {data.exitCode !== undefined && data.exitCode !== 0 && (
              <span className="shell-exit-code">exit {data.exitCode}</span>
            )}
            {data.executionTimeMs !== undefined && (
              <span className="shell-timing">{data.executionTimeMs}ms</span>
            )}
            {hasOutput && (
              <button
                className="shell-copy-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyOutput(stripAnsi(output || stderr));
                }}
                title="Copy output"
              >
                <Copy size={12} />
              </button>
            )}
          </span>
        </div>
        {hasOutput ? (
          <pre className="shell-output-block">
            {output.trim() && <AnsiText text={output.trim()} />}
            {stderr.trim() && <span className="shell-stderr"><AnsiText text={stderr.trim()} /></span>}
          </pre>
        ) : (
          <div className="shell-output-block shell-empty">No output</div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`result-item ${isSelected ? 'selected' : ''}${isShellCommand && shellData?.status && shellData.status !== 'pending' ? ' shell-expanded' : ''}${calcData ? ' calculator-expanded' : ''}`}
      onClick={onLaunch}
      onMouseEnter={onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="result-icon">
        {result.type === SearchResultType.ShellCommand ? (
          <div className="icon-placeholder">
            <Terminal size={24} strokeWidth={2} className="plugin-icon shell" />
          </div>
        ) : result.type === SearchResultType.SystemMonitor ? (
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
              calcData?.queryType === 'timezone' ? (
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

      {result.type === SearchResultType.ShellCommand ? (
        renderShellContent()
      ) : result.type === SearchResultType.SystemMonitor ? (
        renderSystemMonitorContent()
      ) : calcData ? (
        renderCalculatorContent()
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
