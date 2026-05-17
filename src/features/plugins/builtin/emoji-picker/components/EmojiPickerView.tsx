import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { loadEmojiData, getEmojisByGroup } from '../utils/emojiData';
import { searchEmojis } from '../utils/search';
import { applyPreferredSkinTone } from '../utils/skinTones';
import { addToHistory, getFrequentEmojis } from '../utils/history';
import { getEmojiColumns } from '../utils/emojiSettings';
import type { SearchableEmoji } from '../types';
import { EMOJI_GROUPS } from '../types';
import { CustomEmojiTab } from './CustomEmojiTab';
import { cn } from '@/lib/utils';

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
  custom: '✨',
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
  custom: 'custom',
};

export function EmojiPickerView({
  onClose,
  onSelectEmoji,
  initialQuery = '',
}: EmojiPickerViewProps): React.JSX.Element {
  const { t } = useTranslation('emoji-picker');
  const [allEmojis, setAllEmojis] = useState<SearchableEmoji[]>([]);
  const [displayedEmojis, setDisplayedEmojis] = useState<SearchableEmoji[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [gridColumns] = useState(() => getEmojiColumns());

  // Load emoji data on mount
  useEffect(() => {
    void loadEmojiData().then((data) => {
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
      // On the custom tab, the input + grid handle their own input — only honor Escape.
      if (selectedCategory === 'custom') {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        return;
      }

      const gridColumns = 7; // Number of columns in the grid (matches CSS)

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(0, prev - gridColumns));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(displayedEmojis.length - 1, prev + gridColumns)
          );
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
    [displayedEmojis, selectedIndex, onClose, selectedCategory]
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

  const availableCategories = ['all', 'frequent', ...Object.values(EMOJI_GROUPS), 'custom'];

  const isCustomTab = selectedCategory === 'custom';

  return (
    <div
      className="flex flex-col h-full w-full bg-canvas text-ink relative overflow-hidden"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      style={{ outline: 'none' }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-hairline shrink-0">
        <button
          className="flex items-center justify-center w-9 h-9 rounded-md bg-surface text-mute hover:bg-surface-elevated hover:text-ink hover:-translate-x-0.5 transition-all cursor-pointer"
          onClick={onClose}
          title="Back"
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

        <input
          type="text"
          className="flex-1 h-11 px-4 bg-surface border border-hairline rounded-lg text-ink text-base outline-none transition-all focus:bg-surface-elevated focus:border-hairline-strong focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] placeholder:text-stone"
          placeholder={t('view.placeholder')}
          value={searchQuery}
          onChange={handleSearchChange}
          autoFocus
        />

        {!isCustomTab && (
          <button
            className="flex items-center gap-2 h-11 px-3 rounded-lg text-sm font-medium cursor-pointer whitespace-nowrap transition-all bg-accent/10 border border-accent/30 text-accent hover:bg-accent/15"
            onClick={() => handleCategoryChange('custom')}
            title="Generate custom emoji with AI"
          >
            <span className="text-lg leading-none">✨</span>
            <span>Generate</span>
          </button>
        )}

        <div className="relative">
          <button
            className="flex items-center gap-2 h-11 px-3 bg-surface border border-hairline rounded-lg text-ink text-sm cursor-pointer whitespace-nowrap hover:bg-surface-elevated hover:border-hairline-strong transition-all"
            onClick={() => setShowCategoryDropdown(!showCategoryDropdown)}
          >
            <span className="text-lg leading-none">{CATEGORY_ICONS[selectedCategory] || '🔍'}</span>
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
            <div className="absolute top-[calc(100%+8px)] right-0 min-w-[220px] bg-surface border border-hairline rounded-lg shadow-xl z-[1000] overflow-hidden animate-[slideDown_0.15s_ease-out]">
              {availableCategories.map((category) => (
                <button
                  key={category}
                  className={cn(
                    'flex items-center gap-3 w-full px-4 py-3 text-ink text-sm text-left cursor-pointer transition-colors',
                    selectedCategory === category
                      ? 'bg-surface-elevated text-on-dark'
                      : 'hover:bg-surface-elevated'
                  )}
                  onClick={() => handleCategoryChange(category)}
                >
                  <span className="text-lg leading-none">{CATEGORY_ICONS[category] || '📁'}</span>
                  <span>{getCategoryLabel(category)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category info */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-hairline shrink-0">
        <span className="text-sm font-semibold text-ink">{getCategoryLabel(selectedCategory)}</span>
        {!isCustomTab && (
          <span className="text-xs text-stone bg-surface px-2 py-0.5 rounded-full">
            {displayedEmojis.length}
          </span>
        )}
      </div>

      {/* Custom AI emoji tab — totally different content area */}
      {isCustomTab ? (
        <CustomEmojiTab onAfterAction={onClose} />
      ) : (
      /* Emoji Grid */
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-mute py-6">
            {t('loading')}
          </div>
        ) : displayedEmojis.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-mute py-6">
            <div className="text-[56px] opacity-40 animate-pulse">🔍</div>
            <div className="text-base font-medium text-body">{t('view.noEmojis')}</div>
            <div className="text-sm text-stone">{t('view.tryDifferent')}</div>
          </div>
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
          >
            {displayedEmojis.map((emoji, index) => {
              const displayEmoji = applyPreferredSkinTone(emoji);
              const isSelected = index === selectedIndex;

              return (
                <button
                  key={`${emoji.hexcode}-${index}`}
                  className={cn(
                    'emoji-grid-item aspect-square flex items-center justify-center rounded-md cursor-pointer transition-colors p-2 border-2',
                    isSelected
                      ? 'selected bg-surface-elevated border-hairline-strong shadow-[0_0_0_2px_rgba(99,102,241,0.3)]'
                      : 'border-transparent hover:bg-surface-elevated hover:border-hairline'
                  )}
                  onClick={() => handleSelectEmoji(emoji)}
                  title={emoji.label}
                >
                  <span className="text-[28px] leading-none select-none">{displayEmoji}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-hairline shrink-0">
        <div className="flex-1 min-w-0">
          {displayedEmojis[selectedIndex] && (
            <span className="text-sm text-ink truncate">{displayedEmojis[selectedIndex].label}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-stone flex items-center gap-1">
            <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 bg-surface border border-hairline rounded-xs font-mono text-xs text-mute leading-none">
              ↑
            </kbd>
            <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 bg-surface border border-hairline rounded-xs font-mono text-xs text-mute leading-none">
              ↓
            </kbd>
            <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 bg-surface border border-hairline rounded-xs font-mono text-xs text-mute leading-none">
              ←
            </kbd>
            <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 bg-surface border border-hairline rounded-xs font-mono text-xs text-mute leading-none">
              →
            </kbd>
            {' '}Navigate •{' '}
            <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 bg-surface border border-hairline rounded-xs font-mono text-xs text-mute leading-none">
              ↵
            </kbd>
            {' '}Select •{' '}
            <kbd className="inline-flex items-center justify-center min-w-5 px-1.5 py-0.5 bg-surface border border-hairline rounded-xs font-mono text-xs text-mute leading-none">
              Esc
            </kbd>
            {' '}Close
          </span>
        </div>
      </div>
    </div>
  );
}
