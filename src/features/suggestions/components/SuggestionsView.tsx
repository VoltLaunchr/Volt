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
    <div className="flex-1 overflow-y-auto py-3">
      {suggestions.map((category, categoryIndex) => {
        // Translate category header
        const headerKey = CATEGORY_HEADER_KEYS[category.title];
        const categoryTitle = headerKey ? t(headerKey) : category.title;

        return (
          <div key={category.title} className="mb-4 last:mb-0">
            <div className="px-5 mb-1">
              <h3 className="text-xs font-semibold text-mute uppercase tracking-[0.5px] m-0">
                {categoryTitle}
              </h3>
            </div>
            <div className="flex flex-col gap-0.5">
              {category.items.map((item, itemIndex) => {
                const currentIndex = globalIndex++;
                const isSelected = currentIndex === selectedIndex;

                // Translate title and subtitle from common.suggestions.{id}
                const translatedTitle = t(`suggestions.${item.id}.title`, { defaultValue: item.title });
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
                      'flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-all relative',
                      isSelected
                        ? 'bg-accent-blue/20 text-on-dark'
                        : 'hover:bg-surface-elevated'
                    )}
                    onClick={() => onActivate(categoryIndex, itemIndex)}
                    onMouseEnter={() => onSelect(categoryIndex, itemIndex)}
                  >
                    {item.iconSrc ? (
                      <img
                        src={item.iconSrc}
                        alt=""
                        className="w-10 h-10 shrink-0 rounded-md object-contain"
                      />
                    ) : (
                      <div
                        className={cn(
                          'w-10 h-10 flex items-center justify-center shrink-0 rounded-md transition-all',
                          isSelected
                            ? 'bg-white/15 text-on-dark'
                            : 'bg-surface text-mute hover:text-accent-blue'
                        )}
                      >
                        <item.icon size={20} strokeWidth={2} />
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
                        className={cn(
                          'text-xs',
                          isSelected ? 'text-on-dark' : 'text-mute'
                        )}
                      >
                        {translatedSubtitle}
                      </div>
                    </div>
                    {translatedBadge && (
                      <div
                        className={cn(
                          'text-xs px-2 py-1 rounded-sm font-medium shrink-0',
                          isSelected
                            ? 'bg-white/20 text-on-dark'
                            : 'bg-surface text-mute'
                        )}
                      >
                        {translatedBadge}
                      </div>
                    )}
                    {!item.shortcut && item.category === 'command' && (
                      <div
                        className={cn(
                          'text-xs px-2 py-1 rounded-sm font-medium shrink-0',
                          isSelected
                            ? 'bg-white/20 text-on-dark'
                            : 'bg-surface text-mute'
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
