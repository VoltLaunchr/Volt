import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getVersion } from '@tauri-apps/api/app';
import { cn } from '@/lib/utils';
import { SuggestionCategory } from '../../../shared/constants/suggestions';

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

export function SuggestionsView({
  suggestions,
  selectedIndex,
  onSelect,
  onActivate,
}: SuggestionsViewProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const selectedRef = useRef<HTMLDivElement>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  let globalIndex = 0;

  // Pull the runtime version once so the "See what's new" subtitle stays
  // pinned to the actual binary instead of drifting against a hardcoded
  // i18n string. getVersion() reads from tauri.conf.json — same source as
  // the Settings sidebar, so the two displays always agree.
  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {
        // best-effort; leave empty if Tauri runtime is unavailable
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    <div
      className="flex-1 overflow-y-auto px-2 py-3"
      role="listbox"
      aria-label={t('suggestionsHeaders.suggestions')}
    >
      {suggestions.map((category, categoryIndex) => {
        // Translate category header
        const headerKey = CATEGORY_HEADER_KEYS[category.title];
        const categoryTitle = headerKey ? t(headerKey) : category.title;

        return (
          <div key={category.title} className="mb-4 last:mb-0">
            <div className="px-3 mb-1">
              <h3 className="text-xs font-semibold text-mute uppercase tracking-[0.5px] m-0">
                <span className="inline-flex items-center gap-2">
                  <span>{categoryTitle}</span>
                  <span className="h-px w-6 bg-hairline" />
                </span>
              </h3>
            </div>
            <div className="flex flex-col gap-1">
              {category.items.map((item, itemIndex) => {
                const currentIndex = globalIndex++;
                const isSelected = currentIndex === selectedIndex;

                // Translate title and subtitle from common.suggestions.{id}
                const translatedTitle = t(`suggestions.${item.id}.title`, {
                  defaultValue: item.title,
                });
                const translatedSubtitle = t(`suggestions.${item.id}.subtitle`, {
                  defaultValue: item.subtitle,
                  version: appVersion,
                });

                // Translate badge
                const badgeKey = item.shortcut ? BADGE_KEYS[item.shortcut] : undefined;
                const translatedBadge = badgeKey ? t(badgeKey) : item.shortcut;

                return (
                  <div
                    key={item.id}
                    ref={isSelected ? selectedRef : null}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 outline-none cursor-pointer transition-[background,border-color,box-shadow]',
                      isSelected
                        ? 'bg-primary/12 border-primary/25 text-on-dark shadow-[0_1px_0_rgb(255_255_255/0.04)]'
                        : 'hover:bg-surface-elevated/80 hover:border-hairline-soft'
                    )}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onActivate(categoryIndex, itemIndex)}
                    onMouseEnter={() => onSelect(categoryIndex, itemIndex)}
                  >
                    {item.iconSrc ? (
                      <img
                        src={item.iconSrc}
                        alt=""
                        className={cn(
                          'w-9 h-9 shrink-0 rounded-md border object-contain transition-[background,border-color]',
                          isSelected
                            ? 'bg-white/12 border-primary/25'
                            : 'bg-surface/80 border-hairline-soft'
                        )}
                      />
                    ) : (
                      <div
                        className={cn(
                          'w-9 h-9 flex items-center justify-center shrink-0 rounded-md border transition-all',
                          isSelected
                            ? 'bg-white/12 border-primary/25 text-on-dark'
                            : 'bg-surface/80 border-hairline-soft text-mute group-hover:text-accent-blue'
                        )}
                      >
                        <item.icon size={18} strokeWidth={2} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div
                        className={cn(
                          'text-sm font-medium mb-[2px]',
                          isSelected ? 'text-on-dark' : 'text-ink'
                        )}
                      >
                        {translatedTitle}
                      </div>
                      <div
                        className={cn('text-xs', isSelected ? 'text-on-dark-mute' : 'text-mute')}
                      >
                        {translatedSubtitle}
                      </div>
                    </div>
                    {translatedBadge && (
                      <div
                        className={cn(
                          'text-[11px] px-1.5 py-1 rounded-xs font-medium shrink-0 border',
                          isSelected
                            ? 'bg-white/12 border-primary/25 text-on-dark'
                            : 'bg-surface/80 border-hairline-soft text-mute'
                        )}
                      >
                        {translatedBadge}
                      </div>
                    )}
                    {!item.shortcut && item.category === 'command' && (
                      <div
                        className={cn(
                          'text-[11px] px-1.5 py-1 rounded-xs font-medium shrink-0 border',
                          isSelected
                            ? 'bg-white/12 border-primary/25 text-on-dark'
                            : 'bg-surface/80 border-hairline-soft text-mute'
                        )}
                      >
                        {t('suggestionsBadge.command')}
                      </div>
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
}
