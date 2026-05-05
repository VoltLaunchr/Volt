import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { FileInfo } from '../../../shared/types/common.types';
import { logger } from '../../../shared/utils';

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

export function FileSearchView({ onClose }: FileSearchViewProps): React.JSX.Element {
  const { t } = useTranslation('fileSearch');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [typeFilter, setTypeFilter] = useState<FileTypeFilter>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [recentFiles, setRecentFiles] = useState<FileInfo[]>([]);
  const [indexedCount, setIndexedCount] = useState(0);

  // Load recently accessed files + indexed count
  const loadRecentFiles = useCallback(async () => {
    try {
      setIsLoading(true);
      const [recent, count] = await Promise.all([
        invoke<FileInfo[]>('get_recent_files', { limit: 10 }),
        invoke<number>('get_indexed_file_count').catch(() => 0),
      ]);
      setRecentFiles(recent);
      setIndexedCount(count);
    } catch (error) {
      logger.error('Failed to load recent files:', error);
      setRecentFiles([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecentFiles();
  }, [loadRecentFiles]);

  // Refresh when indexing completes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<{ phase: string }>('indexing-progress', ({ payload }) => {
      if (payload.phase === 'complete' || payload.phase === 'db_loaded') {
        void loadRecentFiles();
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
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
      void performSearch(searchQuery);
    }, 200);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch]);

  // Re-filter when type filter changes
  useEffect(() => {
    if (searchQuery.trim()) {
      void performSearch(searchQuery);
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
            void handleOpenFile(selectedFile);
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
      await invoke<void>('launch_application', { path: file.path });
      // Track file access for recent files
      await invoke<void>('track_file_access', { path: file.path, name: file.name });
      // Reload recent files for next time
      void loadRecentFiles();
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
      className="flex flex-col h-full bg-canvas text-ink"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="File search view"
      style={{ outline: 'none' }}
    >
      {/* Header with search and filter */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline bg-surface shrink-0">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-md text-mute transition-all cursor-pointer shrink-0 border-none bg-transparent hover:bg-surface-elevated hover:text-ink"
          onClick={onClose}
          title={t('back')}
        >
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

        <div className="flex-1">
          <input
            type="text"
            className="flex-1 w-full bg-surface-elevated border border-hairline rounded-md px-3 py-1.5 text-sm text-on-dark outline-none focus:border-hairline-strong placeholder:text-ash transition-all"
            placeholder={t('searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
        </div>

        <div className="relative">
          <button
            className="flex items-center gap-2 px-3 py-1.5 bg-canvas border border-hairline rounded-md text-ink text-sm cursor-pointer transition-all whitespace-nowrap hover:bg-surface-elevated hover:border-hairline-strong"
            onClick={() => setShowTypeDropdown(!showTypeDropdown)}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-mute"
            >
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
            <span>
              {typeFilter === 'all'
                ? t('filters.all')
                : t(`filters.${typeFilter}`, { defaultValue: typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1) })}
            </span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-ash"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showTypeDropdown && (
            <div className="absolute top-[calc(100%+4px)] right-0 min-w-40 bg-surface border border-hairline rounded-md shadow-[0_4px_12px_rgba(0,0,0,0.15)] overflow-hidden z-[100]">
              {(['all', 'documents', 'images', 'videos', 'audio', 'code'] as FileTypeFilter[]).map(
                (filter) => (
                  <button
                    key={filter}
                    className={cn(
                      'block w-full px-3.5 py-2.5 text-left text-sm cursor-pointer transition-colors border-none',
                      typeFilter === filter
                        ? 'bg-accent-blue/20 text-on-dark'
                        : 'bg-transparent text-ink hover:bg-surface-elevated'
                    )}
                    onClick={() => {
                      setTypeFilter(filter);
                      setShowTypeDropdown(false);
                    }}
                  >
                    {filter === 'all'
                      ? t('filters.all')
                      : t(`filters.${filter}`, { defaultValue: filter.charAt(0).toUpperCase() + filter.slice(1) })}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Files list */}
        <div className="w-[45%] border-r border-hairline overflow-y-auto bg-canvas">
          {!searchQuery.trim() && (
            <div className="px-4 py-2 text-xs font-semibold text-mute uppercase tracking-[0.5px] bg-surface sticky top-0 z-[1]">
              {t('states.recentlyUsed')}
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center p-5 text-mute text-sm">{t('states.searching')}</div>
          ) : displayFiles.length === 0 ? (
            <div className="flex items-center justify-center p-5 text-mute text-sm">
              {searchQuery.trim() ? (
                t('states.noFiles')
              ) : (
                <div className="text-center p-5">
                  {indexedCount > 0 ? (
                    <div className="mb-3 text-sm text-body">
                      {indexedCount} fichiers indexés — tapez pour rechercher
                    </div>
                  ) : (
                    <>
                      <div className="mb-3 text-sm text-body">{t('states.notIndexed')}</div>
                      <div className="text-xs text-mute">{t('states.configureHint')}</div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            displayFiles.map((file, index) => {
              const isSelected = index === selectedIndex;

              return (
                <div
                  key={file.id}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors relative',
                    isSelected ? 'bg-accent-blue/20 text-on-dark' : 'hover:bg-surface-elevated'
                  )}
                  onClick={() => {
                    setSelectedIndex(index);
                    setSelectedFile(file);
                  }}
                  onDoubleClick={() => {
                    void handleOpenFile(file);
                  }}
                >
                  <div className="w-8 h-8 flex items-center justify-center shrink-0 text-mute text-xl">
                    {getFileIcon(file.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-on-dark truncate font-medium mb-[2px]">{file.name}</div>
                    <div className={cn('text-xs truncate', isSelected ? 'text-white/80' : 'text-ash')}>
                      {file.path}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Details panel */}
        {selectedFile && (
          <div className="flex-1 flex flex-col bg-surface overflow-hidden">
            {/* Preview area */}
            <div className="flex flex-col items-center justify-center p-5 border-b border-hairline bg-canvas">
              <div className="text-[64px] mb-3">{getFileIcon(selectedFile.name)}</div>
              <div className="text-base font-semibold text-ink text-center break-words">
                {selectedFile.name}
              </div>
            </div>

            {/* Metadata */}
            <div className="flex-1 overflow-y-auto p-4">
              <h3 className="text-xs font-semibold text-mute mb-3 uppercase tracking-[0.5px]">
                {t('metadata.title')}
              </h3>

              <div className="flex justify-between items-start py-2 border-b border-hairline last:border-b-0">
                <span className="text-sm text-body shrink-0 min-w-[80px]">{t('metadata.name')}</span>
                <span className="text-sm text-ink font-medium text-right break-all flex-1">{selectedFile.name}</span>
              </div>

              <div className="flex justify-between items-start py-2 border-b border-hairline last:border-b-0">
                <span className="text-sm text-body shrink-0 min-w-[80px]">{t('metadata.where')}</span>
                <span className="text-sm text-ink font-medium text-right break-all flex-1">{selectedFile.path}</span>
              </div>

              <div className="flex justify-between items-start py-2 border-b border-hairline last:border-b-0">
                <span className="text-sm text-body shrink-0 min-w-[80px]">{t('metadata.type')}</span>
                <span className="text-sm text-ink font-medium text-right break-all flex-1">
                  {selectedFile.name.split('.').pop()?.toUpperCase() || t('metadata.fileDefault')}
                </span>
              </div>

              {selectedFile.size !== undefined && (
                <div className="flex justify-between items-start py-2 border-b border-hairline last:border-b-0">
                  <span className="text-sm text-body shrink-0 min-w-[80px]">{t('metadata.size')}</span>
                  <span className="text-xs text-stone shrink-0">{formatFileSize(selectedFile.size)}</span>
                </div>
              )}
            </div>

            {/* Actions footer */}
            <div className="flex gap-2 px-4 py-3 border-t border-hairline bg-canvas">
              <button
                className="flex flex-1 items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-hairline bg-accent-blue text-on-dark cursor-pointer transition-all hover:opacity-90"
                onClick={() => {
                  void handleOpenFile(selectedFile);
                }}
              >
                <span>{t('actions.open')}</span>
                <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white/20 rounded-sm">↵</kbd>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-hairline bg-surface text-xs shrink-0">
        <div className="flex items-center gap-2 text-body font-medium">
          <div className="text-base">🔍</div>
          <span>{t('footer.title')}</span>
        </div>
        <div className="text-mute">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">↑</kbd>
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">↓</kbd>
            {t('footer.hint')} •{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">↵</kbd>
            {t('footer.hintOpen')} •{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">Esc</kbd>
            {t('footer.hintClose')}
          </span>
        </div>
      </div>
    </div>
  );
}
