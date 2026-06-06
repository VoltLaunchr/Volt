import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchResult, SearchResultType } from '../../../shared/types/common.types';
import { ResultItem } from './ResultItem';
import { cn } from '@/lib/utils';

interface ResultsListProps {
  results: SearchResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onLaunch: (result: SearchResult) => void;
}

interface ResultSection {
  key: string;
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
    case SearchResultType.ShellCommand:
      return 'shell';
    case SearchResultType.SystemMonitor:
      // System monitor rows are direct answers ("CPU 42%"), not a list to
      // scan — surface them before the app list so they are visible without
      // scrolling when the user types a monitoring keyword.
      return 'system';
    default:
      return 'results';
  }
}

/** Get section order — prioritize sections that have the most results.
 *
 * 'system' and 'results' carry plugin direct-answers (CPU %, timer, calculator,
 * web search) which are single-value replies to the query, not a list to
 * browse — surface them above the long app list so the user never has to
 * scroll to see them. */
function getSectionOrder(grouped: Map<string, unknown[]>): string[] {
  const base = ['system', 'results', 'applications', 'commands', 'games', 'shell', 'files'];
  const gameCount = grouped.get('games')?.length ?? 0;
  const appCount = grouped.get('applications')?.length ?? 0;
  if (gameCount > appCount) {
    return ['system', 'results', 'games', 'applications', 'commands', 'shell', 'files'];
  }
  return base;
}

export function ResultsList({
  results,
  selectedIndex,
  onSelect,
  onLaunch,
}: ResultsListProps) {
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
          key,
          label: sectionCount > 1 ? t(`sections.${key}`, { defaultValue: key }) : '',
          results: items,
        });
      }
    }

    return ordered;
  }, [results, t]);

  if (results.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-16 text-sm text-ash')}>
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
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
    <div className="flex-1 overflow-y-auto min-h-0">
      <div
        id="results-listbox"
        className="py-1"
        role="listbox"
        aria-label="Search results"
        aria-activedescendant={selectedItemId}
      >
        {sections.map((section, sectionIndex) => (
          <div
            key={`section-${sectionIndex}-${section.key}`}
            role="group"
            aria-label={section.label || undefined}
          >
            {section.label && (
              <div
                className="px-3 pt-3 pb-1 text-[11px] font-medium text-stone uppercase tracking-wider"
                aria-hidden="true"
              >
                {section.label}
              </div>
            )}
            {/* Grid sections: all items in this section use layout='grid' */}
            {section.results.every(({ result }) => result.layout === 'grid') ? (
              <div className="grid grid-cols-4 gap-2 px-3 py-2">
                {section.results.map(({ result, globalIndex }) => (
                  <div
                    key={`${result.id}-${globalIndex}`}
                    ref={globalIndex === selectedIndex ? selectedRef : null}
                    id={`result-item-${globalIndex}`}
                    role="option"
                    aria-selected={globalIndex === selectedIndex}
                    aria-label={result.title}
                    tabIndex={globalIndex === selectedIndex ? 0 : -1}
                    onClick={() => onLaunch(result)}
                    onMouseEnter={() => onSelect(globalIndex)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onLaunch(result);
                      }
                    }}
                  >
                    <ResultItem result={result} isSelected={globalIndex === selectedIndex} globalIndex={globalIndex} />
                  </div>
                ))}
              </div>
            ) : (
              section.results.map(({ result, globalIndex }, itemIndex) => {
                const prevSection =
                  itemIndex > 0 ? section.results[itemIndex - 1].result.section : undefined;
                const showSubHeader = result.section && result.section !== prevSection;

                return (
                  <Fragment key={`${result.id}-${globalIndex}`}>
                    {showSubHeader && (
                      <div
                        className="px-3 pt-2 pb-0.5 text-[10px] font-semibold text-stone uppercase tracking-widest select-none"
                        aria-hidden="true"
                      >
                        {result.section}
                      </div>
                    )}
                    <div
                      ref={globalIndex === selectedIndex ? selectedRef : null}
                      id={`result-item-${globalIndex}`}
                      role="option"
                      aria-selected={globalIndex === selectedIndex}
                      aria-label={`${result.title}${result.subtitle ? ` - ${result.subtitle}` : ''}`}
                      tabIndex={globalIndex === selectedIndex ? 0 : -1}
                      onClick={() => onLaunch(result)}
                      onMouseEnter={() => onSelect(globalIndex)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          onLaunch(result);
                        }
                      }}
                    >
                      <ResultItem result={result} isSelected={globalIndex === selectedIndex} globalIndex={globalIndex} />
                    </div>
                  </Fragment>
                );
              })
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
