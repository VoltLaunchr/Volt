import { invoke } from '@tauri-apps/api/core';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardItem, ClipboardType } from '../../../shared/types/clipboard';
import { logger } from '../../../shared/utils';
import './ClipboardHistoryView.css';

interface ClipboardHistoryViewProps {
  onClose: () => void;
}

type FilterType = 'all' | ClipboardType;

export const ClipboardHistoryView: React.FC<ClipboardHistoryViewProps> = ({ onClose }) => {
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
    loadHistory();
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
            handlePaste(selectedItem);
          }
          break;

        default:
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedIndex, filteredItems, selectedItem, onClose]
  );

  // Handle paste action
  const handlePaste = async (item: ClipboardItem) => {
    try {
      await invoke('copy_to_clipboard', { content: item.content });
      onClose();
    } catch (error) {
      logger.error('Failed to paste:', error);
    }
  };

  // Handle delete action
  const handleDelete = async (item: ClipboardItem) => {
    try {
      await invoke('delete_clipboard_item', { id: item.id });
      await loadHistory();
    } catch (error) {
      logger.error('Failed to delete item:', error);
    }
  };

  // Handle pin toggle
  const handleTogglePin = async (item: ClipboardItem) => {
    try {
      await invoke('toggle_clipboard_pin', { id: item.id });
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
      className="clipboard-history-view"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label="Clipboard history view"
      style={{ outline: 'none' }}
      onFocus={(e) => (e.currentTarget.style.outline = '2px solid var(--color-accent, #0078d4)')}
      onBlur={(e) => (e.currentTarget.style.outline = 'none')}
    >
      {/* Header with search and filter */}
      <div className="clipboard-header">
        <button className="back-button" onClick={onClose} title={t('back')}>
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

        <div className="search-filter-container">
          <input
            type="text"
            className="filter-input"
            placeholder={t('filterPlaceholder')}
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
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
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showTypeDropdown && (
            <div className="type-filter-menu">
              <button
                className={`type-filter-option ${typeFilter === 'all' ? 'active' : ''}`}
                onClick={() => {
                  setTypeFilter('all');
                  setShowTypeDropdown(false);
                }}
              >
                {t('filters.all')}
              </button>
              <button
                className={`type-filter-option ${typeFilter === 'text' ? 'active' : ''}`}
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
                />
                {t('filters.text')}
              </button>
              <button
                className={`type-filter-option ${typeFilter === 'image' ? 'active' : ''}`}
                onClick={() => {
                  setTypeFilter('image');
                  setShowTypeDropdown(false);
                }}
              >
                <img src="/icons/image-03-stroke-rounded.svg" alt={t('filters.image')} width="16" height="16" />
                {t('filters.image')}
              </button>
              <button
                className={`type-filter-option ${typeFilter === 'files' ? 'active' : ''}`}
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
                />
                {t('filters.files')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main content area */}
      <div className="clipboard-content">
        {/* Items list */}
        <div className="clipboard-items-list">
          {isLoading ? (
            <div className="loading-state">{t('states.loading')}</div>
          ) : filteredItems.length === 0 ? (
            <div className="empty-state">{t('states.empty')}</div>
          ) : (
            Object.entries(groupedItems).map(([groupName, groupItems]) => (
              <div key={groupName} className="clipboard-group">
                <div className="group-header">{groupName}</div>
                {groupItems.map((item) => {
                  const globalIndex = filteredItems.indexOf(item);
                  const isSelected = globalIndex === selectedIndex;

                  return (
                    <div
                      key={item.id}
                      className={`clipboard-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedIndex(globalIndex);
                        setSelectedItem(item);
                      }}
                      onDoubleClick={() => handlePaste(item)}
                    >
                      <div className="item-icon">{getTypeIcon(item.contentType)}</div>
                      <div className="item-content">
                        <div className="item-preview">{item.preview}</div>
                        <div className="item-timestamp">{formatTimestamp(item.timestamp)}</div>
                      </div>
                      {item.pinned && <div className="item-pin">📌</div>}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Details panel */}
        {selectedItem && (
          <div className="clipboard-details-panel">
            <div className="details-content">
              {/* Preview area */}
              {selectedItem.contentType === 'image' ? (
                <div className="image-preview">
                  <img
                    src={`data:image/png;base64,${selectedItem.content}`}
                    alt="Clipboard image"
                  />
                </div>
              ) : (
                <div className="text-preview">
                  <pre>{selectedItem.content}</pre>
                </div>
              )}

              {/* Metadata */}
              <div className="details-metadata">
                <div className="metadata-section">
                  <h3>{t('metadata.title')}</h3>

                  {selectedItem.source && (
                    <div className="metadata-row">
                      <span className="metadata-label">{t('metadata.source')}</span>
                      <span className="metadata-value">{selectedItem.source}</span>
                    </div>
                  )}

                  <div className="metadata-row">
                    <span className="metadata-label">{t('metadata.type')}</span>
                    <span className="metadata-value">
                      {selectedItem.contentType.charAt(0).toUpperCase() +
                        selectedItem.contentType.slice(1)}
                    </span>
                  </div>

                  {selectedItem.contentType === 'text' && (
                    <>
                      {selectedItem.charCount !== undefined && (
                        <div className="metadata-row">
                          <span className="metadata-label">{t('metadata.characters')}</span>
                          <span className="metadata-value">
                            {selectedItem.charCount.toLocaleString()}
                          </span>
                        </div>
                      )}
                      {selectedItem.wordCount !== undefined && (
                        <div className="metadata-row">
                          <span className="metadata-label">{t('metadata.words')}</span>
                          <span className="metadata-value">
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
                          <div className="metadata-row">
                            <span className="metadata-label">{t('metadata.dimensions')}</span>
                            <span className="metadata-value">
                              {selectedItem.imageWidth}×{selectedItem.imageHeight}
                            </span>
                          </div>
                        )}
                      {selectedItem.fileSize !== undefined && (
                        <div className="metadata-row">
                          <span className="metadata-label">{t('metadata.size')}</span>
                          <span className="metadata-value">
                            {formatFileSize(selectedItem.fileSize)}
                          </span>
                        </div>
                      )}
                    </>
                  )}

                  <div className="metadata-row">
                    <span className="metadata-label">{t('metadata.copied')}</span>
                    <span className="metadata-value">
                      {formatTimestamp(selectedItem.timestamp)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Actions footer */}
            <div className="details-actions">
              <button className="action-button primary" onClick={() => handlePaste(selectedItem)}>
                <span>{t('actions.paste')}</span>
                <kbd>↵</kbd>
              </button>
              <button className="action-button" onClick={() => handleTogglePin(selectedItem)}>
                {selectedItem.pinned ? t('actions.unpin') : t('actions.pin')}
              </button>
              <button className="action-button danger" onClick={() => handleDelete(selectedItem)}>
                {t('actions.delete')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="clipboard-footer">
        <div className="footer-left">
          <div className="footer-icon">📋</div>
          <span>{t('footer.title')}</span>
        </div>
        <div className="footer-right">
          <span className="footer-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> {t('footer.hint')} • <kbd>↵</kbd> {t('footer.hintPaste')} • <kbd>Esc</kbd> {t('footer.hintClose')}
          </span>
        </div>
      </div>
    </div>
  );
};
