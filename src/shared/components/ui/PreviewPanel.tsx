import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { SearchResult, SearchResultType } from '../../types/common.types';
import type { ShellOutputData } from '../../../features/plugins/builtin/shell';

interface FilePreview {
  path: string;
  name: string;
  size: number;
  modified: number;
  previewType: 'text' | 'image' | 'folder' | 'application' | 'binary';
  content: string | null;
  children: string[] | null;
  metadata: Record<string, string>;
}

interface PreviewPanelProps {
  result: SearchResult | null;
  isOpen: boolean;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PreviewPanel({ result, isOpen }: PreviewPanelProps) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const lastPathRef = useRef<string>('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // No `preview` in deps — we read the "already fetched" state from the ref.
  // Keeping `preview` as a dep recreated fetchPreview on every successful
  // fetch, which retriggered the effect and rescheduled the debounce timer.
  const fetchPreview = useCallback(async (path: string) => {
    if (path === lastPathRef.current) return;
    lastPathRef.current = path;
    setLoading(true);
    try {
      const data = await invoke<FilePreview>('get_file_preview', { path });
      setPreview(data);
    } catch {
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen || !result) {
      setPreview(null);
      lastPathRef.current = '';
      return;
    }

    const path =
      (result.data as { path?: string })?.path || result.subtitle || '';

    if (!path) return;

    // Debounce 200ms for keyboard navigation
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchPreview(path);
    }, 200);

    return () => clearTimeout(debounceRef.current);
  }, [isOpen, result, fetchPreview]);

  if (!isOpen) return null;

  if (!result) {
    return (
      <div className="flex flex-col bg-surface border-l border-hairline h-full overflow-hidden w-[300px] shrink-0">
        <div className="flex items-center justify-center h-full text-mute text-xs">
          Select a result to preview
        </div>
      </div>
    );
  }

  if (result.type === SearchResultType.ShellCommand) {
    const shellData = result.data as unknown as ShellOutputData | undefined;
    return (
      <div
        className="flex flex-col bg-surface border-l border-hairline h-full overflow-hidden w-[300px] shrink-0"
        role="region"
        aria-label="Shell command preview"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-hairline shrink-0">
          <span className="text-sm font-medium text-ink truncate">
            {'> ' + (shellData?.command || '')}
          </span>
          {shellData?.executionTimeMs !== undefined && (
            <span className="text-sm text-body shrink-0 ml-2">{shellData.executionTimeMs}ms</span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {shellData?.status === 'done' ? (
            <pre className="font-mono text-xs text-body bg-surface-card rounded-md p-3 overflow-auto whitespace-pre-wrap break-words m-0">
              {shellData.stdout || shellData.stderr || 'No output'}
            </pre>
          ) : shellData?.status === 'running' ? (
            <pre className="font-mono text-xs text-body bg-surface-card rounded-md p-3 overflow-auto whitespace-pre-wrap break-words m-0">
              {(shellData.stdout || '') + '\n...'}
            </pre>
          ) : shellData?.status === 'error' ? (
            <pre className="font-mono text-xs text-body bg-surface-card rounded-md p-3 overflow-auto whitespace-pre-wrap break-words m-0">
              {shellData.errorMessage || 'Unknown error'}
            </pre>
          ) : (
            <div className="flex items-center justify-center h-full text-mute text-xs">
              Press Enter to run command
            </div>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col bg-surface border-l border-hairline h-full overflow-hidden w-[300px] shrink-0">
        <div className="flex items-center justify-center h-full text-mute text-xs">
          Loading...
        </div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="flex flex-col bg-surface border-l border-hairline h-full overflow-hidden w-[300px] shrink-0">
        <div className="flex items-center justify-center h-full text-mute text-xs">
          No preview available
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col bg-surface border-l border-hairline h-full overflow-hidden w-[300px] shrink-0"
      role="region"
      aria-label="File preview"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline shrink-0">
        {result.icon && (
          <img className="w-6 h-6 shrink-0 rounded-sm object-contain" src={result.icon} alt="" />
        )}
        <span className="text-sm font-medium text-ink truncate">{preview.name}</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {preview.previewType === 'text' && preview.content && (
          <>
            <pre className="font-mono text-xs text-body bg-surface-card rounded-md p-3 overflow-auto whitespace-pre-wrap break-words m-0">
              {preview.content}
            </pre>
            {preview.metadata.truncated === 'true' && (
              <div className="mt-2 pt-2 border-t border-hairline text-[11px] text-mute italic">
                Content truncated ({preview.metadata.line_count} lines shown)
              </div>
            )}
          </>
        )}

        {preview.previewType === 'image' && preview.metadata.image_path && (
          <img
            className="rounded-md overflow-hidden max-h-48 w-full object-contain block mx-auto"
            src={convertFileSrc(preview.metadata.image_path)}
            alt={preview.name}
          />
        )}

        {preview.previewType === 'folder' && preview.children && (
          <ul className="list-none p-0 m-0">
            {preview.children.map((child) => (
              <li
                key={child}
                className={`py-1 text-xs flex items-center gap-1 ${child.endsWith('/') ? 'text-accent-blue font-medium' : 'text-body'}`}
              >
                {child.endsWith('/') ? '📁' : '📄'} {child}
              </li>
            ))}
          </ul>
        )}

        {(preview.previewType === 'application' || preview.previewType === 'binary') && (
          <div className="space-y-3 mt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-ash uppercase tracking-wide font-medium">Type</span>
              <span className="text-sm text-body">
                {preview.metadata.extension?.toUpperCase() || preview.previewType}
              </span>
            </div>
          </div>
        )}

        {/* Always show metadata */}
        <div className="space-y-3 mt-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ash uppercase tracking-wide font-medium">Size</span>
            <span className="text-sm text-body">{preview.metadata.size_formatted}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ash uppercase tracking-wide font-medium">Modified</span>
            <span className="text-sm text-body">{formatDate(preview.modified)}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-ash uppercase tracking-wide font-medium">Path</span>
            <span className="text-sm text-body break-all" title={preview.path}>
              {preview.path}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
