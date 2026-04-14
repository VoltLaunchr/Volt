import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchResult, SearchResultType } from '../../../shared/types/common.types';
import { ResultItem } from './ResultItem';
import './ResultsList.css';

interface ResultsListProps {
  results: SearchResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onLaunch: (result: SearchResult) => void;
}

interface ResultSection {
  label: string;
  results: { result: SearchResult; globalIndex: number }[];
}

/** Map result type → section key for grouping */
function getSectionKey(type: SearchResultType): string {
  switch (type) {
    case SearchResultType.Application:
      return 'applications';
    case SearchResultType.Game:
      return 'games';
    case SearchResultType.SystemCommand:
      return 'commands';
    case SearchResultType.File:
      return 'files';
    default:
      return 'results';
  }
}

/** Get section order — prioritize sections that have the most results */
function getSectionOrder(grouped: Map<string, unknown[]>): string[] {
  const base = ['applications', 'commands', 'games', 'results', 'files'];
  // If games section has more items than apps, put games first
  const gameCount = (grouped.get('games') as unknown[] | undefined)?.length ?? 0;
  const appCount = (grouped.get('applications') as unknown[] | undefined)?.length ?? 0;
  if (gameCount > appCount) {
    return ['games', 'applications', 'commands', 'results', 'files'];
  }
  return base;
}

/** Section labels */
const SECTION_LABELS: Record<string, string> = {
  applications: 'Applications',
  commands: 'Commands',
  games: 'Games',
  results: 'Results',
  files: 'Files',
};

export const ResultsList: React.FC<ResultsListProps> = ({
  results,
  selectedIndex,
  onSelect,
  onLaunch,
}) => {
  const { t } = useTranslation('results');
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

  // Group results by section, preserving score order within each section
  const sections = useMemo(() => {
    const grouped = new Map<string, { result: SearchResult; globalIndex: number }[]>();

    results.forEach((result, globalIndex) => {
      const key = getSectionKey(result.type);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push({ result, globalIndex });
    });

    // Only show section headers if there are multiple sections
    const sectionCount = grouped.size;

    const sectionOrder = getSectionOrder(grouped);
    const ordered: ResultSection[] = [];
    for (const key of sectionOrder) {
      const items = grouped.get(key);
      if (items && items.length > 0) {
        ordered.push({
          label: sectionCount > 1 ? SECTION_LABELS[key] || key : '',
          results: items,
        });
      }
    }

    return ordered;
  }, [results]);

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
        <p className="text-secondary">{t('empty')}</p>
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
      {sections.map((section) => (
        <div key={section.label || 'single'} className="results-section">
          {section.label && (
            <div className="results-section-header">{section.label}</div>
          )}
          {section.results.map(({ result, globalIndex }) => (
            <div
              key={`${result.id}-${globalIndex}`}
              ref={globalIndex === selectedIndex ? selectedRef : null}
              id={`result-item-${globalIndex}`}
              role="option"
              aria-selected={globalIndex === selectedIndex}
            >
              <ResultItem
                result={result}
                isSelected={globalIndex === selectedIndex}
                index={globalIndex}
                onSelect={() => onSelect(globalIndex)}
                onLaunch={() => onLaunch(result)}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
};
