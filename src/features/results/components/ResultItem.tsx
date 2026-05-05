import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppWindow,
  Copy,
  Equal,
  File,
  FolderOpen,
  Globe,
  Loader2,
} from 'lucide-react';

const APP_ICON = {
  calculator: '/icons/app/calculator_icon.svg',
  webSearch: '/icons/app/web_search_icon.svg',
  timer: '/icons/app/pomodoro_icon.svg',
  systemMonitor: '/icons/app/system_monitor_icon.svg',
  games: '/icons/app/games_icon.svg',
  shell: '/icons/app/shell_icon.svg',
  systemCommand: '/icons/app/settings_icon.svg',
  fileSearch: '/icons/app/file_search_icon.svg',
} as const;
import { SearchResult, SearchResultType } from '../../../shared/types/common.types';
import type { ShellOutputData } from '../../plugins/builtin/shell';
import { stripAnsi } from '../../plugins/builtin/shell';
import { AnsiText } from '../../plugins/builtin/shell/ansiParser';
import { highlightMatch, HighlightSegment } from '../../../shared/utils/highlightMatch';
import { useSearchStore } from '../../../stores/searchStore';
import { cn } from '@/lib/utils';

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
          <span key={i} className="text-ink font-medium">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function ResultItem({ result, isSelected }: ResultItemProps) {
  const searchQuery = useSearchStore((s) => s.searchQuery);

  const titleSegments = useMemo(
    () => highlightMatch(result.title, searchQuery),
    [result.title, searchQuery],
  );

  // Render custom system monitor item with progress bar
  const renderSystemMonitorIcon = () => (
    <img
      src={APP_ICON.systemMonitor}
      alt=""
      className="w-8 h-8 object-contain shrink-0 rounded-md"
    />
  );

  const renderSystemMonitorContent = () => {
    if (!isSystemMonitorData(result.data)) {
      return (
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-sm text-on-dark truncate leading-tight">{result.title}</div>
          {result.subtitle && (
            <div className="text-xs text-mute truncate leading-tight mt-0.5">{result.subtitle}</div>
          )}
        </div>
      );
    }
    const data = result.data;

    const rawValue = Number(data.value);
    const value = Number.isFinite(rawValue) ? Math.min(100, Math.max(0, rawValue)) : 0;
    const color = data.color || '#10b981';

    return (
      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-sm text-on-dark truncate leading-tight">{result.title}</div>
        {result.subtitle && (
          <div className="text-xs text-mute truncate leading-tight mt-0.5">{result.subtitle}</div>
        )}
        <div
          className="mt-1 h-0.5 w-full overflow-hidden bg-hairline"
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${result.title}: ${value}%`}
        >
          <div
            className="h-full transition-[width] duration-300"
            style={{ width: `${value}%`, backgroundColor: color }}
          />
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
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-sm text-on-dark truncate leading-tight">{result.title}</div>
          {result.subtitle && (
            <div className="text-xs text-mute truncate leading-tight mt-0.5">{result.subtitle}</div>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-3 mt-0.5">
          <div className="flex flex-col">
            <span className="text-sm text-body tabular-nums">{calcData.expression}</span>
            <span className="text-[10px] text-ash uppercase tracking-[0.5px]">Expression</span>
          </div>
          <div className="text-mute shrink-0">
            <Equal size={14} strokeWidth={2} />
          </div>
          <div className="flex flex-col">
            <span className="text-sm text-primary tabular-nums font-semibold">{calcData.formatted}</span>
            <span className="text-[10px] text-ash uppercase tracking-[0.5px]">Result</span>
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
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-sm text-on-dark leading-tight">
            {data.command ? `> ${data.command}` : 'Shell Command Mode'}
          </div>
          <div className="text-xs text-mute truncate leading-tight mt-0.5">
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
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-sm text-on-dark leading-tight">{`> ${data.command}`}</div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-mute">
            <Loader2 size={12} className="animate-spin shrink-0" />
            <span>Running... (Ctrl+C to cancel)</span>
          </div>
          {hasPartialOutput && (
            <pre className="mt-0.5 text-xs font-mono bg-surface p-1.5 overflow-auto max-h-20 text-body whitespace-pre-wrap break-all">
              {partialStdout && <AnsiText text={partialStdout} />}
              {partialStderr && <span className="text-[#ef4444]"><AnsiText text={partialStderr} /></span>}
            </pre>
          )}
        </div>
      );
    }

    if (data.status === 'error') {
      return (
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-sm text-on-dark leading-tight">{`> ${data.command}`}</div>
          <div className="mt-0.5 text-xs text-[#ef4444]">
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
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-on-dark leading-tight">{`> ${data.command}`}</span>
          <span className="flex items-center gap-1.5 shrink-0">
            {data.timedOut && <span className="text-[#f59e0b] text-[10px]">timed out</span>}
            {data.exitCode !== undefined && data.exitCode !== 0 && (
              <span className="text-[#ef4444] text-[10px] tabular-nums">exit {data.exitCode}</span>
            )}
            {data.executionTimeMs !== undefined && (
              <span className="text-ash text-[10px] tabular-nums">{data.executionTimeMs}ms</span>
            )}
            {hasOutput && (
              <button
                className="p-0.5 text-ash hover:text-on-dark cursor-pointer bg-transparent border-0 transition-colors"
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
          <pre className="mt-0.5 text-xs font-mono bg-surface p-1.5 overflow-auto max-h-20 text-body whitespace-pre-wrap break-all">
            {output.trim() && <AnsiText text={output.trim()} />}
            {stderr.trim() && <span className="text-[#ef4444]"><AnsiText text={stderr.trim()} /></span>}
          </pre>
        ) : (
          <div className="mt-0.5 text-xs text-ash">No output</div>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        'flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors outline-none border-l-[2px]',
        isSelected
          ? 'bg-surface-elevated border-l-primary'
          : 'hover:bg-surface-elevated border-l-transparent',
        isShellCommand && shellData?.status && shellData.status !== 'pending' && 'items-start pt-2',
      )}
    >
      {/* Left icon area (32×32px) */}
      {result.type === SearchResultType.ShellCommand ? (
        <img src={APP_ICON.shell} alt="" className="w-8 h-8 object-contain shrink-0 rounded-md" />
      ) : result.type === SearchResultType.SystemMonitor ? (
        renderSystemMonitorIcon()
      ) : result.icon ? (
        <img src={result.icon} alt="" className="w-8 h-8 object-contain shrink-0" />
      ) : result.type === SearchResultType.File ? (
        <img src={APP_ICON.fileSearch} alt="" className="w-8 h-8 object-contain shrink-0 rounded-md" />
      ) : result.type === SearchResultType.Game ? (
        <img src={APP_ICON.games} alt="" className="w-8 h-8 object-contain shrink-0 rounded-md" />
      ) : result.type === SearchResultType.Calculator ? (
        <img
          src={calcData?.queryType === 'timezone' ? APP_ICON.timer : APP_ICON.calculator}
          alt=""
          className="w-8 h-8 object-contain shrink-0 rounded-md"
        />
      ) : result.type === SearchResultType.WebSearch ? (
        <img src={APP_ICON.webSearch} alt="" className="w-8 h-8 object-contain shrink-0 rounded-md" />
      ) : result.type === SearchResultType.SystemCommand ? (
        <img src={APP_ICON.systemCommand} alt="" className="w-8 h-8 object-contain shrink-0 rounded-md" />
      ) : result.type === SearchResultType.Timer ? (
        <img src={APP_ICON.timer} alt="" className="w-8 h-8 object-contain shrink-0 rounded-md" />
      ) : (
        <div className="flex items-center justify-center w-8 h-8 shrink-0 text-body">
          {result.type === SearchResultType.File ? (
            <File size={24} strokeWidth={2} className="w-4 h-4 text-mute" />
          ) : result.type === SearchResultType.Application ? (
            <AppWindow size={24} strokeWidth={2} className="w-4 h-4 text-mute" />
          ) : result.type === SearchResultType.Url ? (
            <Globe size={24} strokeWidth={2} className="w-4 h-4 text-mute" />
          ) : (
            <FolderOpen size={24} strokeWidth={2} className="w-4 h-4 text-mute" />
          )}
        </div>
      )}

      {/* Content area */}
      {result.type === SearchResultType.ShellCommand ? (
        renderShellContent()
      ) : result.type === SearchResultType.SystemMonitor ? (
        renderSystemMonitorContent()
      ) : calcData ? (
        renderCalculatorContent()
      ) : (
        <div className="flex flex-col min-w-0 flex-1">
          <div className="text-sm text-on-dark truncate leading-tight">
            <HighlightedText segments={titleSegments} />
          </div>
          {result.subtitle && (
            <div className="text-xs text-mute truncate leading-tight mt-0.5">{result.subtitle}</div>
          )}
        </div>
      )}

      {/* Show badge: explicit badge > type badge > shortcut */}
      {result.badge ? (
        <div className="shrink-0 text-xs text-ash">{result.badge}</div>
      ) : (
        <div className="shrink-0 text-xs text-ash">
          {result.type === SearchResultType.Application && 'Application'}
          {result.type === SearchResultType.File && 'File'}
          {result.type === SearchResultType.Game && 'Game'}
          {result.type === SearchResultType.SystemCommand && 'Command'}
          {result.type === SearchResultType.Calculator && 'Calculator'}
          {result.type === SearchResultType.WebSearch && 'Web Search'}
          {result.type === SearchResultType.Url && 'URL'}
          {result.type === SearchResultType.Timer && 'Timer'}
          {result.type === SearchResultType.SystemMonitor && 'System'}
          {result.type === SearchResultType.Plugin && 'Plugin'}
        </div>
      )}
    </div>
  );
}
