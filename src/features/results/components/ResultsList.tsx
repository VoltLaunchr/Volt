import { Fragment, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { SearchX } from 'lucide-react';
import { SearchResult } from '../../../shared/types/common.types';
import { ResultItem } from './ResultItem';
import { getResultSectionKey } from '../resultSections';

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

export function ResultsList({ results, selectedIndex, onSelect, onLaunch }: ResultsListProps) {
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

  // Build contiguous section runs without changing the canonical result order.
  // Keyboard navigation and Alt+number operate on `results[index]`, so merging
  // non-contiguous rows into one section would make visual and command order
  // disagree.
  const sections = useMemo(() => {
    // Only show section headers if there are multiple sections
    const sectionCount = new Set(results.map(getResultSectionKey)).size;
    const ordered: ResultSection[] = [];

    results.forEach((result, globalIndex) => {
      const key = getResultSectionKey(result);
      const previous = ordered.at(-1);
      if (previous?.key === key) {
        previous.results.push({ result, globalIndex });
      } else {
        ordered.push({
          key,
          label: sectionCount > 1 ? t(`sections.${key}`, { defaultValue: key }) : '',
          results: [{ result, globalIndex }],
        });
      }
    });

    return ordered;
  }, [results, t]);

  if (results.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-12 text-center">
        <div className="flex max-w-[320px] flex-col items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-hairline bg-surface/70 text-mute shadow-[inset_0_1px_0_rgb(255_255_255/0.04)]">
            <SearchX size={20} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <p className="m-0 text-sm font-medium text-ink">{t('empty')}</p>
            <p className="m-0 text-xs leading-relaxed text-mute">{t('emptyHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  const selectedItemId =
    selectedIndex >= 0 && selectedIndex < results.length
      ? `result-item-${selectedIndex}`
      : undefined;

  return (
    <div className="flex-1 overflow-y-auto min-h-0 px-1 py-1">
      <div
        id="results-listbox"
        className="space-y-0.5"
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
                <span className="inline-flex items-center gap-2">
                  <span>{section.label}</span>
                  <span className="h-px w-6 bg-hairline" />
                </span>
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
                    <ResultItem
                      result={result}
                      isSelected={globalIndex === selectedIndex}
                      globalIndex={globalIndex}
                    />
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
                      <ResultItem
                        result={result}
                        isSelected={globalIndex === selectedIndex}
                        globalIndex={globalIndex}
                      />
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
