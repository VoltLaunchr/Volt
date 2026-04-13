import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadEmojiData, getEmojisByGroup } from '../utils/emojiData';
import { searchEmojis } from '../utils/search';
import { applyPreferredSkinTone } from '../utils/skinTones';
import { addToHistory, getFrequentEmojis } from '../utils/history';
import type { SearchableEmoji } from '../types';
import { EMOJI_GROUPS } from '../types';
import './EmojiPickerView.css';

interface EmojiPickerViewProps {
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
  initialQuery?: string;
}

const CATEGORY_ICONS: Record<string, string> = {
  all: '🔍',
  frequent: '🕐',
  'smileys-emotion': '😀',
  'people-body': '👋',
  'animals-nature': '🐶',
  'food-drink': '🍕',
  'travel-places': '✈️',
  activities: '⚽',
  objects: '💡',
  symbols: '❤️',
  flags: '🏴',
};

// Map from emoji group key to i18n translation key
const CATEGORY_I18N_KEY: Record<string, string> = {
  all: 'all',
  frequent: 'frequent',
  'smileys-emotion': 'smileys',
  'people-body': 'people',
  'animals-nature': 'animals',
  'food-drink': 'food',
  'travel-places': 'travel',
  activities: 'activity',
  objects: 'objects',
  symbols: 'symbols',
  flags: 'flags',
};

export const EmojiPickerView: React.FC<EmojiPickerViewProps> = ({
  onClose,
  onSelectEmoji,
  initialQuery = '',
}) => {
  const { t } = useTranslation('emoji-picker');
  const [allEmojis, setAllEmojis] = useState<SearchableEmoji[]>([]);
  const [displayedEmojis, setDisplayedEmojis] = useState<SearchableEmoji[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);

  // Load emoji data on mount
  useEffect(() => {
    loadEmojiData().then((data) => {
      setAllEmojis(data);
      setIsLoading(false);
      updateDisplayedEmojis(data, selectedCategory, searchQuery);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update displayed emojis when category or search changes
  const updateDisplayedEmojis = useCallback(
    (emojis: SearchableEmoji[], category: string, query: string) => {
      let filtered = emojis;

      // Apply search filter
      if (query.trim()) {
        filtered = searchEmojis(emojis, query);
      } else if (category === 'frequent') {
        // Show frequently used
        const frequentList = getFrequentEmojis(50);
        filtered = frequentList
          .map((emoji) => emojis.find((e) => e.emoji === emoji))
          .filter((e): e is SearchableEmoji => e !== undefined);
      } else if (category !== 'all') {
        // Filter by category
        filtered = getEmojisByGroup(emojis, category);
      }

      setDisplayedEmojis(filtered);
      setSelectedIndex(0);
    },
    []
  );

  // Handle search input change
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    updateDisplayedEmojis(allEmojis, selectedCategory, query);
  };

  // Handle category change
  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    setShowCategoryDropdown(false);
    updateDisplayedEmojis(allEmojis, category, searchQuery);
  };

  // Handle emoji selection
  const handleSelectEmoji = (emoji: SearchableEmoji) => {
    const displayEmoji = applyPreferredSkinTone(emoji);
    onSelectEmoji(displayEmoji);
    addToHistory(displayEmoji);
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const gridColumns = 7; // Number of columns in the grid (matches CSS)

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - gridColumns));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(displayedEmojis.length - 1, prev + gridColumns));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(displayedEmojis.length - 1, prev + 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (displayedEmojis[selectedIndex]) {
            handleSelectEmoji(displayedEmojis[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayedEmojis, selectedIndex, onClose]
  );

  // Scroll selected emoji into view
  useEffect(() => {
    const selectedElement = document.querySelector('.emoji-grid-item.selected');
    if (selectedElement) {
      selectedElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedIndex]);

  const getCategoryLabel = (category: string): string => {
    const i18nKey = CATEGORY_I18N_KEY[category];
    if (i18nKey) {
      return t(`view.categories.${i18nKey}`);
    }
    return category;
  };

  const availableCategories = ['all', 'frequent', ...Object.values(EMOJI_GROUPS)];

  return (
    <div
      className="emoji-picker-view"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      {/* Header */}
      <div className="emoji-picker-header">
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

        <input
          type="text"
          className="emoji-search-input"
          placeholder={t('view.placeholder')}
          value={searchQuery}
          onChange={handleSearchChange}
          autoFocus
        />

        <div className="category-dropdown">
          <button
            className="category-dropdown-button"
            onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
          >
            <span className="category-icon">{CATEGORY_ICONS[selectedCategory] || '🔍'}</span>
            <span>{getCategoryLabel(selectedCategory)}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              style={{
                transform: showCategoryDropdown ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {showCategoryDropdown && (
            <div className="category-dropdown-menu">
              {availableCategories.map((category) => (
                <button
                  key={category}
                  className={`category-option ${selectedCategory === category ? 'active' : ''}`}
                  onClick={() => handleCategoryChange(category)}
                >
                  <span className="category-icon">{CATEGORY_ICONS[category] || '📁'}</span>
                  <span>{getCategoryLabel(category)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category info */}
      <div className="category-info">
        <span className="category-name">{getCategoryLabel(selectedCategory)}</span>
        <span className="emoji-count">{displayedEmojis.length}</span>
      </div>

      {/* Emoji Grid */}
      <div className="emoji-grid-container">
        {isLoading ? (
          <div className="loading-state">{t('loading')}</div>
        ) : displayedEmojis.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔍</div>
            <div className="empty-message">{t('view.noEmojis')}</div>
            <div className="empty-hint">{t('view.tryDifferent')}</div>
          </div>
        ) : (
          <div className="emoji-grid">
            {displayedEmojis.map((emoji, index) => {
              const displayEmoji = applyPreferredSkinTone(emoji);
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={`${emoji.hexcode}-${index}`}
                  className={`emoji-grid-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => handleSelectEmoji(emoji)}
                  title={emoji.label}
                >
                  <span className="emoji-char">{displayEmoji}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="emoji-picker-footer">
        <div className="footer-left">
          {displayedEmojis[selectedIndex] && (
            <span className="selected-emoji-label">{displayedEmojis[selectedIndex].label}</span>
          )}
        </div>
        <div className="footer-right">
          <span className="footer-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> Navigate • <kbd>↵</kbd> Select •{' '}
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
};
