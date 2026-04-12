import React, { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  // Derive the live-region announcement from the current state
  const liveAnnouncement = (() => {
    if (resultCount === undefined || !value.trim()) return '';
    if (resultCount === 0) return 'No results found';
    if (resultCount === 1) return '1 result found';
    return `${resultCount} results found`;
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
        aria-label="Search"
        aria-autocomplete="list"
        aria-controls="results-listbox"
      />
      {value && (
        <button className="clear-button" onClick={() => onChange('')} aria-label="Clear search">
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
