import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ClipboardItem, ClipboardType } from '../../../shared/types/clipboard';
import { logger } from '../../../shared/utils';

interface ClipboardHistoryViewProps {
  onClose: () => void;
}

type FilterType = 'all' | ClipboardType;

export function ClipboardHistoryView({ onClose }: ClipboardHistoryViewProps): React.JSX.Element {
  const { t } = useTranslation('clipboard');
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<ClipboardItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ClipboardItem | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filterQuery, setFilterQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);

  // Load clipboard history
  const loadHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      const history = await invoke<ClipboardItem[]>('get_clipboard_history', { limit: 100 });
      setItems(history);
      if (history.length > 0) {
        setSelectedItem(history[0]);
      }
    } catch (error) {
      logger.error('Failed to load clipboard history:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Filter items based on search query and type filter
  useEffect(() => {
    let filtered = items;

    // Filter by type
    if (typeFilter !== 'all') {
      filtered = filtered.filter((item) => item.contentType === typeFilter);
    }

    // Filter by search query
    if (filterQuery.trim()) {
      const query = filterQuery.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.preview.toLowerCase().includes(query) || item.content.toLowerCase().includes(query)
      );
    }

    setFilteredItems(filtered);

    // Reset selection
    if (filtered.length > 0) {
      setSelectedIndex(0);
      setSelectedItem(filtered[0]);
    } else {
      setSelectedIndex(0);
      setSelectedItem(null);
    }
  }, [items, filterQuery, typeFilter]);

  // Handle paste action
  const handlePaste = useCallback(
    async (item: ClipboardItem) => {
      try {
        await invoke<void>('copy_to_clipboard', { content: item.content });
        onClose();
      } catch (error) {
        logger.error('Failed to paste:', error);
      }
    },
    [onClose]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (selectedIndex < filteredItems.length - 1) {
            const newIndex = selectedIndex + 1;
            setSelectedIndex(newIndex);
            setSelectedItem(filteredItems[newIndex]);
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1;
            setSelectedIndex(newIndex);
            setSelectedItem(filteredItems[newIndex]);
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (selectedItem) {
            void handlePaste(selectedItem);
          }
          break;

        default:
          break;
      }
    },
    [selectedIndex, filteredItems, selectedItem, onClose, handlePaste]
  );

  // Paste all visible text items in sequence
  const handlePasteSequentially = async () => {
    const textItems = filteredItems.filter((i) => i.contentType === 'text').map((i) => i.content);
    if (textItems.length === 0) return;
    try {
      onClose();
      await invoke<void>('paste_sequentially', { texts: textItems });
    } catch (error) {
      logger.error('Failed to paste sequentially:', error);
    }
  };

  // Handle delete action
  const handleDelete = async (item: ClipboardItem) => {
    try {
      await invoke<void>('delete_clipboard_item', { id: item.id });
      await loadHistory();
    } catch (error) {
      logger.error('Failed to delete item:', error);
    }
  };

  // Handle pin toggle
  const handleTogglePin = async (item: ClipboardItem) => {
    try {
      await invoke<void>('toggle_clipboard_pin', { id: item.id });
      await loadHistory();
    } catch (error) {
      logger.error('Failed to toggle pin:', error);
    }
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Format timestamp
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date >= today) {
      return `${t('groups.today')} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    } else if (date >= yesterday) {
      return `${t('groups.yesterday')} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get icon for type
  const getTypeIcon = (type: ClipboardType): React.ReactElement => {
    switch (type) {
      case 'text':
        return (
          <img src="/icons/text-creation-stroke-rounded.svg" alt="Text" width="20" height="20" />
        );
      case 'image':
        return <img src="/icons/image-03-stroke-rounded.svg" alt="Image" width="20" height="20" />;
      case 'files':
        return (
          <img src="/icons/text-creation-stroke-rounded.svg" alt="Files" width="20" height="20" />
        );
      default:
        return (
          <img
            src="/icons/text-creation-stroke-rounded.svg"
            alt="Clipboard"
            width="20"
            height="20"
          />
        );
    }
  };

  // Group items by date
  const groupedItems = filteredItems.reduce(
    (groups, item) => {
      const date = new Date(item.timestamp * 1000);
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      let groupKey: string;
      if (date.toDateString() === today.toDateString()) {
        groupKey = t('groups.today');
      } else if (date.toDateString() === yesterday.toDateString()) {
        groupKey = t('groups.yesterday');
      } else {
        groupKey = date.toLocaleDateString(undefined, {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(item);
      return groups;
    },
    {} as Record<string, ClipboardItem[]>
  );

  return (
    <div
      className="flex flex-col h-full bg-canvas text-ink"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Clipboard history view"
      style={{ outline: 'none' }}
      onFocus={(e) => (e.currentTarget.style.outline = '2px solid var(--color-accent, #0078d4)')}
      onBlur={(e) => (e.currentTarget.style.outline = 'none')}
    >
      {/* Header with search and filter */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline bg-surface shrink-0">
        <button
          className="flex items-center justify-center w-8 h-8 rounded-md text-mute transition-all cursor-pointer shrink-0 hover:bg-surface-elevated hover:text-ink"
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
            placeholder={t('filterPlaceholder')}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
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
              <button
                className={cn(
                  'flex items-center gap-2 w-full px-3.5 py-2.5 text-left text-sm cursor-pointer transition-colors border-none',
                  typeFilter === 'all' ? 'bg-accent-blue/20 text-on-dark' : 'bg-transparent text-ink hover:bg-surface-elevated'
                )}
                onClick={() => {
                  setTypeFilter('all');
                  setShowTypeDropdown(false);
                }}
              >
                {t('filters.all')}
              </button>
              <button
                className={cn(
                  'flex items-center gap-2 w-full px-3.5 py-2.5 text-left text-sm cursor-pointer transition-colors border-none',
                  typeFilter === 'text' ? 'bg-accent-blue/20 text-on-dark' : 'bg-transparent text-ink hover:bg-surface-elevated'
                )}
                onClick={() => {
                  setTypeFilter('text');
                  setShowTypeDropdown(false);
                }}
              >
                <img
                  src="/icons/text-creation-stroke-rounded.svg"
                  alt={t('filters.text')}
                  width="16"
                  height="16"
                  className={typeFilter === 'text' ? 'brightness-0 saturate-100 invert' : 'brightness-0 saturate-100 invert-[60%]'}
                />
                {t('filters.text')}
              </button>
              <button
                className={cn(
                  'flex items-center gap-2 w-full px-3.5 py-2.5 text-left text-sm cursor-pointer transition-colors border-none',
                  typeFilter === 'image' ? 'bg-accent-blue/20 text-on-dark' : 'bg-transparent text-ink hover:bg-surface-elevated'
                )}
                onClick={() => {
                  setTypeFilter('image');
                  setShowTypeDropdown(false);
                }}
              >
                <img
                  src="/icons/image-03-stroke-rounded.svg"
                  alt={t('filters.image')}
                  width="16"
                  height="16"
                  className={typeFilter === 'image' ? 'brightness-0 saturate-100 invert' : 'brightness-0 saturate-100 invert-[60%]'}
                />
                {t('filters.image')}
              </button>
              <button
                className={cn(
                  'flex items-center gap-2 w-full px-3.5 py-2.5 text-left text-sm cursor-pointer transition-colors border-none',
                  typeFilter === 'files' ? 'bg-accent-blue/20 text-on-dark' : 'bg-transparent text-ink hover:bg-surface-elevated'
                )}
                onClick={() => {
                  setTypeFilter('files');
                  setShowTypeDropdown(false);
                }}
              >
                <img
                  src="/icons/text-creation-stroke-rounded.svg"
                  alt={t('filters.files')}
                  width="16"
                  height="16"
                  className={typeFilter === 'files' ? 'brightness-0 saturate-100 invert' : 'brightness-0 saturate-100 invert-[60%]'}
                />
                {t('filters.files')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Items list */}
        <div className="w-[45%] border-r border-hairline overflow-y-auto bg-canvas">
          {isLoading ? (
            <div className="flex items-center justify-center p-5 text-mute text-sm">{t('states.loading')}</div>
          ) : filteredItems.length === 0 ? (
            <div className="flex items-center justify-center p-5 text-mute text-sm">{t('states.empty')}</div>
          ) : (
            Object.entries(groupedItems).map(([groupName, groupItems]) => (
              <div key={groupName} className="mb-3">
                <div className="px-4 py-2 text-xs font-semibold text-mute uppercase tracking-[0.5px] bg-surface sticky top-0 z-[1]">
                  {groupName}
                </div>
                {groupItems.map((item) => {
                  const globalIndex = filteredItems.indexOf(item);
                  const isSelected = globalIndex === selectedIndex;

                  return (
                    <div
                      key={item.id}
                      className={cn(
                        'flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors relative',
                        isSelected ? 'bg-accent-blue/20 text-on-dark' : 'hover:bg-surface-elevated'
                      )}
                      onClick={() => {
                        setSelectedIndex(globalIndex);
                        setSelectedItem(item);
                      }}
                      onDoubleClick={() => {
                        void handlePaste(item);
                      }}
                    >
                      <div className="text-xl shrink-0 w-6 text-center flex items-center justify-center">
                        <span className={cn(isSelected ? '[&_img]:brightness-0 [&_img]:saturate-100 [&_img]:invert' : '[&_img]:brightness-0 [&_img]:saturate-100 [&_img]:invert-[60%] [&_img]:opacity-80')}>
                          {getTypeIcon(item.contentType)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs text-body truncate mb-[2px]">
                          {item.preview}
                        </div>
                        <div className={cn('text-[11px] shrink-0', isSelected ? 'text-white/80' : 'text-ash')}>
                          {formatTimestamp(item.timestamp)}
                        </div>
                      </div>
                      {item.pinned && <div className="shrink-0 text-sm">📌</div>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Details panel */}
        {selectedItem && (
          <div className="flex-1 flex flex-col bg-surface overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              {/* Preview area */}
              {selectedItem.contentType === 'image' ? (
                <div className="w-full max-h-[300px] bg-canvas border border-hairline rounded-md overflow-hidden flex items-center justify-center mb-4">
                  <img
                    src={`data:image/png;base64,${selectedItem.content}`}
                    alt="Clipboard image"
                    className="max-w-full max-h-[300px] object-contain"
                  />
                </div>
              ) : (
                <div className="w-full max-h-[300px] bg-canvas border border-hairline rounded-md overflow-auto mb-4 p-3">
                  <pre className="m-0 text-sm font-mono text-ink whitespace-pre-wrap break-words">
                    {selectedItem.content}
                  </pre>
                </div>
              )}

              {/* Metadata */}
              <div className="mt-3">
                <div>
                  <h3 className="text-xs font-semibold text-mute mb-3 uppercase tracking-[0.5px]">
                    {t('metadata.title')}
                  </h3>

                  {selectedItem.source && (
                    <div className="flex justify-between items-center py-2 border-b border-hairline last:border-b-0">
                      <span className="text-sm text-body">{t('metadata.source')}</span>
                      <span className="text-sm text-ink font-medium">{selectedItem.source}</span>
                    </div>
                  )}

                  <div className="flex justify-between items-center py-2 border-b border-hairline last:border-b-0">
                    <span className="text-sm text-body">{t('metadata.type')}</span>
                    <span className="text-sm text-ink font-medium">
                      {selectedItem.contentType.charAt(0).toUpperCase() +
                        selectedItem.contentType.slice(1)}
                    </span>
                  </div>

                  {selectedItem.contentType === 'text' && (
                    <>
                      {selectedItem.charCount !== undefined && (
                        <div className="flex justify-between items-center py-2 border-b border-hairline last:border-b-0">
                          <span className="text-sm text-body">{t('metadata.characters')}</span>
                          <span className="text-sm text-ink font-medium">
                            {selectedItem.charCount.toLocaleString()}
                          </span>
                        </div>
                      )}
                      {selectedItem.wordCount !== undefined && (
                        <div className="flex justify-between items-center py-2 border-b border-hairline last:border-b-0">
                          <span className="text-sm text-body">{t('metadata.words')}</span>
                          <span className="text-sm text-ink font-medium">
                            {selectedItem.wordCount.toLocaleString()}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  {selectedItem.contentType === 'image' && (
                    <>
                      {selectedItem.imageWidth !== undefined &&
                        selectedItem.imageHeight !== undefined && (
                          <div className="flex justify-between items-center py-2 border-b border-hairline last:border-b-0">
                            <span className="text-sm text-body">{t('metadata.dimensions')}</span>
                            <span className="text-sm text-ink font-medium">
                              {selectedItem.imageWidth}×{selectedItem.imageHeight}
                            </span>
                          </div>
                        )}
                      {selectedItem.fileSize !== undefined && (
                        <div className="flex justify-between items-center py-2 border-b border-hairline last:border-b-0">
                          <span className="text-sm text-body">{t('metadata.size')}</span>
                          <span className="text-sm text-ink font-medium">
                            {formatFileSize(selectedItem.fileSize)}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="flex justify-between items-center py-2 border-b border-hairline last:border-b-0">
                    <span className="text-sm text-body">{t('metadata.copied')}</span>
                    <span className="text-sm text-ink font-medium">
                      {formatTimestamp(selectedItem.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions footer */}
            <div className="flex gap-2 px-4 py-3 border-t border-hairline bg-canvas flex-wrap">
              <button
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-hairline bg-accent-blue text-on-dark cursor-pointer transition-all hover:opacity-90"
                onClick={() => {
                  void handlePaste(selectedItem);
                }}
              >
                <span>{t('actions.paste')}</span>
                <kbd className="px-1.5 py-0.5 text-xs font-mono bg-white/20 rounded-sm">↵</kbd>
              </button>
              {filteredItems.filter((i) => i.contentType === 'text').length > 1 && (
                <button
                  className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-hairline bg-surface text-ink cursor-pointer transition-all hover:bg-surface-elevated hover:border-hairline-strong"
                  onClick={() => {
                    void handlePasteSequentially();
                  }}
                  title="Paste all text items in sequence"
                >
                  {t('actions.pasteSequentially', { defaultValue: 'Paste Sequentially' })}
                </button>
              )}
              <button
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-hairline bg-surface text-ink cursor-pointer transition-all hover:bg-surface-elevated hover:border-hairline-strong"
                onClick={() => {
                  void handleTogglePin(selectedItem);
                }}
              >
                {selectedItem.pinned ? t('actions.unpin') : t('actions.pin')}
              </button>
              <button
                className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-md border border-accent-red bg-transparent text-accent-red cursor-pointer transition-all hover:bg-accent-red hover:text-on-dark"
                onClick={() => {
                  void handleDelete(selectedItem);
                }}
              >
                {t('actions.delete')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-hairline bg-surface text-xs shrink-0">
        <div className="flex items-center gap-2 text-body font-medium">
          <div className="text-base">📋</div>
          <span>{t('footer.title')}</span>
        </div>
        <div className="text-mute">
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">↑</kbd>
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">↓</kbd>
            {t('footer.hint')} •{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">↵</kbd>
            {t('footer.hintPaste')} •{' '}
            <kbd className="px-1.5 py-0.5 text-xs font-mono bg-canvas border border-hairline rounded-sm text-body">Esc</kbd>
            {t('footer.hintClose')}
          </span>
        </div>
      </div>
    </div>
  );
}
