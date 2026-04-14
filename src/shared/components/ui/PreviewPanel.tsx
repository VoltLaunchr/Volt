import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { SearchResult } from '../../types/common.types';
import './PreviewPanel.css';

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

  const fetchPreview = useCallback(async (path: string) => {
    if (path === lastPathRef.current && preview) return;
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
  }, [preview]);

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
    debounceRef.current = setTimeout(() => fetchPreview(path), 200);

    return () => clearTimeout(debounceRef.current);
  }, [isOpen, result, fetchPreview]);

  if (!isOpen) return null;

  if (!result) {
    return (
      <div className="preview-panel">
        <div className="preview-empty">Select a result to preview</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="preview-panel">
        <div className="preview-empty">Loading...</div>
      </div>
    );
  }

  if (!preview) {
    return (
      <div className="preview-panel">
        <div className="preview-empty">No preview available</div>
      </div>
    );
  }

  return (
    <div className="preview-panel" role="region" aria-label="File preview">
      <div className="preview-panel-header">
        {result.icon && (
          <img className="preview-icon" src={result.icon} alt="" />
        )}
        <span className="preview-title">{preview.name}</span>
      </div>

      <div className="preview-panel-content">
        {preview.previewType === 'text' && preview.content && (
          <>
            <pre className="preview-text">{preview.content}</pre>
            {preview.metadata.truncated === 'true' && (
              <div className="preview-truncated">
                Content truncated ({preview.metadata.line_count} lines shown)
              </div>
            )}
          </>
        )}

        {preview.previewType === 'image' && preview.metadata.image_path && (
          <img
            className="preview-image"
            src={convertFileSrc(preview.metadata.image_path)}
            alt={preview.name}
          />
        )}

        {preview.previewType === 'folder' && preview.children && (
          <ul className="preview-folder-list">
            {preview.children.map((child) => (
              <li
                key={child}
                className={child.endsWith('/') ? 'is-dir' : ''}
              >
                {child.endsWith('/') ? '📁' : '📄'} {child}
              </li>
            ))}
          </ul>
        )}

        {(preview.previewType === 'application' ||
          preview.previewType === 'binary') && (
          <div className="preview-meta">
            <div className="preview-meta-row">
              <span className="preview-meta-label">Type</span>
              <span className="preview-meta-value">
                {preview.metadata.extension?.toUpperCase() || preview.previewType}
              </span>
            </div>
          </div>
        )}

        {/* Always show metadata */}
        <div className="preview-meta">
          <div className="preview-meta-row">
            <span className="preview-meta-label">Size</span>
            <span className="preview-meta-value">
              {preview.metadata.size_formatted}
            </span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Modified</span>
            <span className="preview-meta-value">
              {formatDate(preview.modified)}
            </span>
          </div>
          <div className="preview-meta-row">
            <span className="preview-meta-label">Path</span>
            <span className="preview-meta-value" title={preview.path}>
              {preview.path}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
