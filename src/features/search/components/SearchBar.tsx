import React, { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import './SearchBar.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoFocus?: boolean;
  resultCount?: number;
  selectedIndex?: number;
  isSearching?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onKeyDown,
  placeholder = 'Type to search...',
  autoFocus = true,
  resultCount,
  selectedIndex,
  isSearching = false,
}: SearchBarProps): React.JSX.Element {
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
    <div
      className={cn(
        'search-bar relative flex items-center h-[60px] px-4 gap-3 border-b border-hairline shrink-0',
      )}
      data-searching={isSearching ? 'true' : 'false'}
    >
      <div className="search-bar__icon text-mute shrink-0">
        <Search size={20} strokeWidth={2} />
      </div>
      <input
        ref={inputRef}
        id="search-input"
        type="text"
        className="search-bar__input flex-1 bg-transparent text-on-dark text-[15px] placeholder:text-ash outline-none caret-on-dark"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        aria-label={t('search.label')}
        aria-busy={isSearching}
        aria-autocomplete="list"
        aria-controls="results-listbox"
        aria-activedescendant={
          selectedIndex !== undefined && selectedIndex >= 0
            ? `result-item-${selectedIndex}`
            : undefined
        }
      />
      {value && (
        <button
          className="shrink-0 text-ash hover:text-on-dark transition-colors p-1 rounded-xs cursor-pointer"
          onClick={() => onChange('')}
          aria-label={t('search.clearSearch')}
        >
          <X size={16} strokeWidth={2} />
        </button>
      )}
      {/* Live region: announces result count to screen readers */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {isSearching ? t('search.searching') : liveAnnouncement}
      </span>
      <div className="search-bar__track" aria-hidden="true">
        <span className="search-bar__beam-glow" />
        <span className="search-bar__beam-core" />
      </div>
    </div>
  );
}
