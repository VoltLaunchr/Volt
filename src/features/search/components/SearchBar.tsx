import React, { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './SearchBar.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  resultCount?: number;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  onKeyDown,
  placeholder = 'Type to search...',
  autoFocus = true,
  resultCount,
}) => {
  const { t } = useTranslation('common');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Derive the live-region announcement from the current state
  const liveAnnouncement = (() => {
    if (resultCount === undefined || !value.trim()) return '';
    if (resultCount === 0) return t('search.noResults');
    return t('search.resultCount', { count: resultCount });
  })();

  return (
    <div className="search-bar">
      <div className="search-icon">
        <Search size={20} strokeWidth={2} />
      </div>
      <input
        ref={inputRef}
        id="search-input"
        type="text"
        className="search-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={t('search.label')}
        aria-autocomplete="list"
        aria-controls="results-listbox"
      />
      {value && (
        <button className="clear-button" onClick={() => onChange('')} aria-label={t('search.clearSearch')}>
          <X size={16} strokeWidth={2} />
        </button>
      )}
      {/* Live region: announces result count to screen readers */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </span>
    </div>
  );
};
