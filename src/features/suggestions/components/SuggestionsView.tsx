import React, { useEffect, useRef } from 'react';
import { SuggestionCategory } from '../../../shared/constants/suggestions';
import './SuggestionsView.css';

interface SuggestionsViewProps {
  suggestions: SuggestionCategory[];
  selectedIndex: number;
  onSelect: (categoryIndex: number, itemIndex: number) => void;
  onActivate: (categoryIndex: number, itemIndex: number) => void;
}

export const SuggestionsView: React.FC<SuggestionsViewProps> = ({
  suggestions,
  selectedIndex,
  onSelect,
  onActivate,
}) => {
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
      {suggestions.map((category, categoryIndex) => (
        <div key={category.title} className="suggestion-category">
          <div className="suggestion-category-header">
            <h3 className="suggestion-category-title">{category.title}</h3>
          </div>
          <div className="suggestion-items">
            {category.items.map((item, itemIndex) => {
              const currentIndex = globalIndex++;
              const isSelected = currentIndex === selectedIndex;

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
                    <div className="suggestion-item-title">{item.title}</div>
                    <div className="suggestion-item-subtitle">{item.subtitle}</div>
                  </div>
                  {item.shortcut && <div className="suggestion-item-badge">{item.shortcut}</div>}
                  {!item.shortcut && item.category === 'command' && (
                    <div className="suggestion-item-badge">Command</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
