import React, { useEffect, useRef } from 'react';
import { SearchResult } from '../../../shared/types/common.types';
import { ResultItem } from './ResultItem';
import './ResultsList.css';

interface ResultsListProps {
  results: SearchResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onLaunch: (result: SearchResult) => void;
}

export const ResultsList: React.FC<ResultsListProps> = ({
  results,
  selectedIndex,
  onSelect,
  onLaunch,
}) => {
  const selectedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  if (results.length === 0) {
    return (
      <div className="results-empty">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <p className="text-secondary">No results found</p>
      </div>
    );
  }

  const selectedItemId =
    selectedIndex >= 0 && selectedIndex < results.length
      ? `result-item-${selectedIndex}`
      : undefined;

  return (
    <div
      id="results-listbox"
      className="results-list"
      role="listbox"
      aria-label="Search results"
      aria-activedescendant={selectedItemId}
    >
      {results.map((result, index) => (
        <div
          key={`${result.id}-${index}`}
          ref={index === selectedIndex ? selectedRef : null}
          id={`result-item-${index}`}
          role="option"
          aria-selected={index === selectedIndex}
        >
          <ResultItem
            result={result}
            isSelected={index === selectedIndex}
            index={index}
            onSelect={() => onSelect(index)}
            onLaunch={() => onLaunch(result)}
          />
        </div>
      ))}
    </div>
  );
};
