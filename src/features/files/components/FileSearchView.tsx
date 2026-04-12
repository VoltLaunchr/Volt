import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useState } from 'react';
import { FileInfo } from '../../../shared/types/common.types';
import { logger } from '../../../shared/utils';
import './FileSearchView.css';

interface FileSearchViewProps {
  onClose: () => void;
}

type FileTypeFilter = 'all' | 'documents' | 'images' | 'videos' | 'audio' | 'code' | 'other';

const FILE_TYPE_EXTENSIONS: Record<FileTypeFilter, string[]> = {
  all: [],
  documents: ['pdf', 'doc', 'docx', 'txt', 'md', 'xlsx', 'pptx', 'odt'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'],
  videos: ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma'],
  code: ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'rs', 'go', 'php', 'rb', 'swift'],
  other: [],
};

export const FileSearchView: React.FC<FileSearchViewProps> = ({ onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [recentFiles, setRecentFiles] = useState<FileInfo[]>([]);

  // Load recently accessed files
  const loadRecentFiles = useCallback(async () => {
    try {
      setIsLoading(true);
      const recent = await invoke<FileInfo[]>('get_recent_files', {
        limit: 10,
      });
      setRecentFiles(recent);
    } catch (error) {
      logger.error('Failed to load recent files:', error);
      setRecentFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRecentFiles();
  }, [loadRecentFiles]);

  // Perform file search
  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        setFiles([]);
        return;
      }

      try {
        setIsLoading(true);
        const results = await invoke<FileInfo[]>('search_files', {
          query,
          limit: 50,
        });

        // Filter by file type if needed
        let filtered = results;
        if (typeFilter !== 'all') {
          const extensions = FILE_TYPE_EXTENSIONS[typeFilter];
          filtered = results.filter((file) => {
            const ext = file.name.split('.').pop()?.toLowerCase();
            return ext && extensions.includes(ext);
          });
        }

        setFiles(filtered);
        if (filtered.length > 0) {
          setSelectedIndex(0);
          setSelectedFile(filtered[0]);
        } else {
          setSelectedFile(null);
        }
      } catch (error) {
        logger.error('Failed to search files:', error);
        setFiles([]);
      } finally {
        setIsLoading(false);
      }
    },
    [typeFilter]
  );

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch]);

  // Re-filter when type filter changes
  useEffect(() => {
    if (searchQuery.trim()) {
      performSearch(searchQuery);
    }
  }, [typeFilter, searchQuery, performSearch]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const currentFiles = searchQuery.trim() ? files : recentFiles;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (selectedIndex < currentFiles.length - 1) {
            const newIndex = selectedIndex + 1;
            setSelectedIndex(newIndex);
            setSelectedFile(currentFiles[newIndex]);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1;
            setSelectedIndex(newIndex);
            setSelectedFile(currentFiles[newIndex]);
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedFile) {
            handleOpenFile(selectedFile);
          }
          break;

        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIndex, files, recentFiles, selectedFile, searchQuery, onClose]
  );

  // Handle file opening
  const handleOpenFile = async (file: FileInfo) => {
    try {
      await invoke('launch_application', { path: file.path });
      // Track file access for recent files
      await invoke('track_file_access', { path: file.path, name: file.name });
      // Reload recent files for next time
      loadRecentFiles();
      onClose();
    } catch (error) {
      logger.error('Failed to open file:', error);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // Get file icon based on extension
  const getFileIcon = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext) return '📄';

    if (FILE_TYPE_EXTENSIONS.documents.includes(ext)) return '📄';
    if (FILE_TYPE_EXTENSIONS.images.includes(ext)) return '🖼️';
    if (FILE_TYPE_EXTENSIONS.videos.includes(ext)) return '🎬';
    if (FILE_TYPE_EXTENSIONS.audio.includes(ext)) return '🎵';
    if (FILE_TYPE_EXTENSIONS.code.includes(ext)) return '💻';
    return '📄';
  };

  // Get display files (recent or search results)
  const displayFiles = searchQuery.trim() ? files : recentFiles;

  return (
    <div
      className="file-search-view"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="File search view"
      style={{ outline: 'none' }}
    >
      {/* Header with search and filter */}
      <div className="file-search-header">
        <button className="back-button" onClick={onClose} title="Back">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="search-input-container">
          <input
            type="text"
            className="file-search-input"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="type-filter-dropdown">
          <button
            className="type-filter-button"
            onClick={() => setShowTypeDropdown(!showTypeDropdown)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
            <span>
              {typeFilter === 'all'
                ? 'All Types'
                : typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1)}
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showTypeDropdown && (
            <div className="type-filter-menu">
              {(['all', 'documents', 'images', 'videos', 'audio', 'code'] as FileTypeFilter[]).map(
                (filter) => (
                  <button
                    key={filter}
                    className={`type-filter-option ${typeFilter === filter ? 'active' : ''}`}
                    onClick={() => {
                      setTypeFilter(filter);
                      setShowTypeDropdown(false);
                    }}
                  >
                    {filter === 'all'
                      ? 'All Types'
                      : filter.charAt(0).toUpperCase() + filter.slice(1)}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="file-search-content">
        {/* Files list */}
        <div className="file-list">
          {!searchQuery.trim() && <div className="section-header">Recently Used</div>}

          {isLoading ? (
            <div className="loading-state">Searching...</div>
          ) : displayFiles.length === 0 ? (
            <div className="empty-state">
              {searchQuery.trim() ? (
                'No files found'
              ) : (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <div style={{ marginBottom: '12px', fontSize: '14px' }}>No files indexed yet</div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                    Configure folders to index in Settings → File Search
                  </div>
                </div>
              )}
            </div>
          ) : (
            displayFiles.map((file, index) => {
              const isSelected = index === selectedIndex;

              return (
                <div
                  key={file.id}
                  className={`file-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedIndex(index);
                    setSelectedFile(file);
                  }}
                  onDoubleClick={() => handleOpenFile(file)}
                >
                  <div className="file-icon">{getFileIcon(file.name)}</div>
                  <div className="file-info">
                    <div className="file-name">{file.name}</div>
                    <div className="file-path">{file.path}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Details panel */}
        {selectedFile && (
          <div className="file-details-panel">
            <div className="details-preview">
              <div className="preview-icon">{getFileIcon(selectedFile.name)}</div>
              <div className="preview-name">{selectedFile.name}</div>
            </div>

            {/* Metadata */}
            <div className="details-metadata">
              <h3>Metadata</h3>

              <div className="metadata-row">
                <span className="metadata-label">Name</span>
                <span className="metadata-value">{selectedFile.name}</span>
              </div>

              <div className="metadata-row">
                <span className="metadata-label">Where</span>
                <span className="metadata-value">{selectedFile.path}</span>
              </div>

              <div className="metadata-row">
                <span className="metadata-label">Type</span>
                <span className="metadata-value">
                  {selectedFile.name.split('.').pop()?.toUpperCase() || 'File'}
                </span>
              </div>

              {selectedFile.size !== undefined && (
                <div className="metadata-row">
                  <span className="metadata-label">Size</span>
                  <span className="metadata-value">{formatFileSize(selectedFile.size)}</span>
                </div>
              )}
            </div>

            {/* Actions footer */}
            <div className="details-actions">
              <button
                className="action-button primary"
                onClick={() => handleOpenFile(selectedFile)}
              >
                <span>Open</span>
                <kbd>↵</kbd>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="file-search-footer">
        <div className="footer-left">
          <div className="footer-icon">🔍</div>
          <span>Search Files</span>
        </div>
        <div className="footer-right">
          <span className="footer-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> Navigate • <kbd>↵</kbd> Open • <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
};
