import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SuggestionCategory } from '../../../shared/constants/suggestions';
import './SuggestionsView.css';

interface SuggestionsViewProps {
  suggestions: SuggestionCategory[];
  selectedIndex: number;
  onSelect: (categoryIndex: number, itemIndex: number) => void;
  onActivate: (categoryIndex: number, itemIndex: number) => void;
}

/** Map category titles to i18n keys */
const CATEGORY_HEADER_KEYS: Record<string, string> = {
  Suggestions: 'suggestionsHeaders.suggestions',
  Commands: 'suggestionsHeaders.commands',
};

/** Map shortcut badge values to i18n keys */
const BADGE_KEYS: Record<string, string> = {
  Command: 'suggestionsBadge.command',
  Changelog: 'suggestionsBadge.changelog',
};

export const SuggestionsView: React.FC<SuggestionsViewProps> = ({
  suggestions,
  selectedIndex,
  onSelect,
  onActivate,
}) => {
  const { t } = useTranslation('common');
  const selectedRef = useRef<HTMLDivElement>(null);
  let globalIndex = 0;

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  return (
    <div className="suggestions-view">
      {suggestions.map((category, categoryIndex) => {
        // Translate category header
        const headerKey = CATEGORY_HEADER_KEYS[category.title];
        const categoryTitle = headerKey ? t(headerKey) : category.title;

        return (
          <div key={category.title} className="suggestion-category">
            <div className="suggestion-category-header">
              <h3 className="suggestion-category-title">{categoryTitle}</h3>
            </div>
            <div className="suggestion-items">
              {category.items.map((item, itemIndex) => {
                const currentIndex = globalIndex++;
                const isSelected = currentIndex === selectedIndex;

                // Translate title and subtitle from common.suggestions.{id}
                const translatedTitle = t(`suggestions.${item.id}.title`, { defaultValue: item.title });
                const translatedSubtitle = t(`suggestions.${item.id}.subtitle`, { defaultValue: item.subtitle });

                // Translate badge
                const badgeKey = item.shortcut ? BADGE_KEYS[item.shortcut] : undefined;
                const translatedBadge = badgeKey ? t(badgeKey) : item.shortcut;

                return (
                  <div
                    key={item.id}
                    ref={isSelected ? selectedRef : null}
                    className={`suggestion-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => onActivate(categoryIndex, itemIndex)}
                    onMouseEnter={() => onSelect(categoryIndex, itemIndex)}
                  >
                    <div className="suggestion-item-icon">
                      <item.icon size={20} strokeWidth={2} />
                    </div>
                    <div className="suggestion-item-content">
                      <div className="suggestion-item-title">{translatedTitle}</div>
                      <div className="suggestion-item-subtitle">{translatedSubtitle}</div>
                    </div>
                    {translatedBadge && <div className="suggestion-item-badge">{translatedBadge}</div>}
                    {!item.shortcut && item.category === 'command' && (
                      <div className="suggestion-item-badge">{t('suggestionsBadge.command')}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
