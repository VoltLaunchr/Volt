import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { HotkeyCapture, Spinner } from '../../../shared/components/ui';
import { Input } from '@/shared/components/ui/input';
import { SettingsPageHeader, SettingsSelect } from '../components/SettingsChrome';
import { getShortcutCategoryMeta } from '../components/ShortcutCategoryIcon';
import { useShortcutAppIcons } from '../hooks/useShortcutAppIcons';
import { settingsRowDomId } from '../registry/settingsRegistry';
import type { AppShortcut } from '../types/settings.types';
import {
  ROW_HEIGHT,
  SHORTCUT_ICON_PREFETCH_LIMIT,
  filterShortcuts,
  listShortcutCategories,
  shortcutCategory,
  visibleRange,
} from './shortcutsList';

const OVERSCAN = 8;
/** Fixed heights (px) of the hero and the sticky list header: the windowing maths rely on them. */
const HERO_HEIGHT = 168;
const TOOLBAR_HEIGHT = 56;
const SKELETON_ROWS = 8;

export type AppListVariant = 'applications' | 'shortcuts';

interface AppListPageProps {
  variant: AppListVariant;
  shortcuts: AppShortcut[];
  /** True until the first list (persisted or freshly scanned) is available. */
  loading: boolean;
  /** True while a background rescan is merging into the list. */
  refreshing: boolean;
  onSave: (shortcut: AppShortcut) => Promise<void>;
  onHotkeyError: (message: string | null) => void;
}

const HERO_ICON: Record<AppListVariant, string> = {
  applications: '/icons/app/app_icon.svg',
  shortcuts: '/icons/app/short_cut_icon.svg',
};

interface AppRowProps {
  shortcut: AppShortcut;
  iconSrc: string | undefined;
  editing: boolean;
  onStartEdit: (id: string) => void;
  onStopEdit: () => void;
  onSave: (shortcut: AppShortcut) => Promise<void>;
  onIconError: (path: string) => void;
  onHotkeyError: (message: string | null) => void;
}

const AppRow = memo(function AppRow({
  shortcut,
  iconSrc,
  editing,
  onStartEdit,
  onStopEdit,
  onSave,
  onIconError,
  onHotkeyError,
}: AppRowProps) {
  const { t } = useTranslation('settings');
  const meta = getShortcutCategoryMeta(shortcutCategory(shortcut));
  const CategoryIcon = meta.Icon;
  const commitAlias = (alias: string) => {
    const next = alias.trim();
    onStopEdit();
    if (next !== (shortcut.alias ?? '')) void onSave({ ...shortcut, alias: next || undefined });
  };
  return (
    <div className="settings-vrow">
      <span className="settings-vrow__name text-[13px]">
        {iconSrc ? (
          <img
            src={iconSrc}
            alt=""
            loading="lazy"
            decoding="async"
            className="size-5 shrink-0 rounded-[4px] object-contain"
            onError={() => onIconError(shortcut.path)}
          />
        ) : (
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-[5px]',
              meta.bgClass,
              meta.colorClass
            )}
          >
            <CategoryIcon className="size-3.5" />
          </span>
        )}
        <span className="min-w-0 truncate">{shortcut.name}</span>
      </span>
      <span className="settings-vrow__alias flex min-w-0 items-center">
        {editing ? (
          <Input
            type="text"
            className="h-7 w-full"
            defaultValue={shortcut.alias ?? ''}
            autoFocus
            onBlur={(event) => commitAlias(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitAlias(event.currentTarget.value);
              else if (event.key === 'Escape') {
                event.stopPropagation();
                onStopEdit();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={cn('settings-vrow__ghost', shortcut.alias && 'settings-vrow__ghost--set')}
            title={t('shortcuts.addAlias')}
            onClick={() => onStartEdit(shortcut.id)}
          >
            {shortcut.alias || t('shortcuts.tableHeaders.alias')}
          </button>
        )}
      </span>
      <span className="settings-vrow__hotkey flex min-w-0 items-center [&_button]:w-full [&_button]:justify-center">
        <HotkeyCapture
          value={shortcut.hotkey ?? ''}
          onChange={(hotkey) => void onSave({ ...shortcut, hotkey: hotkey || undefined })}
          onError={onHotkeyError}
        />
      </span>
      <span className="flex items-center justify-center">
        <input
          type="checkbox"
          className="size-4 cursor-pointer accent-[var(--primary)]"
          aria-label={shortcut.name}
          checked={shortcut.enabled}
          onChange={() => void onSave({ ...shortcut, enabled: !shortcut.enabled })}
        />
      </span>
    </div>
  );
});

/**
 * Applications / Shortcuts page. The list comes from the app cache the launch-time scan already
 * filled and refreshes itself, so there is no manual scan action. Search, category filter and
 * editing state are local (typing never re-renders the rest of Settings) and only the rows in view
 * are mounted, which keeps hundreds of applications smooth.
 */
export function ShortcutsPage({
  variant,
  shortcuts,
  loading,
  refreshing,
  onSave,
  onHotkeyError,
}: AppListPageProps) {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const categories = useMemo(() => listShortcutCategories(shortcuts), [shortcuts]);
  const rows = useMemo(
    () => filterShortcuts(shortcuts, deferredQuery, categoryFilter),
    [shortcuts, deferredQuery, categoryFilter]
  );

  const listTop = HERO_HEIGHT + TOOLBAR_HEIGHT;
  const range = visibleRange(
    rows.length,
    ROW_HEIGHT,
    scrollTop - listTop,
    viewportHeight,
    OVERSCAN
  );
  const windowRows = useMemo(
    () => rows.slice(range.start, range.end),
    [rows, range.start, range.end]
  );
  const iconCandidates = useMemo(
    () => windowRows.slice(0, SHORTCUT_ICON_PREFETCH_LIMIT),
    [windowRows]
  );
  const { getShortcutIconSrc, markIconFailed } = useShortcutAppIcons(iconCandidates, true);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    setViewportHeight(element.clientHeight);
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const frame = useRef<number | null>(null);
  const handleScroll = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setScrollTop(scrollerRef.current?.scrollTop ?? 0);
    });
  }, []);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  // A new filter shows the first results instead of an arbitrary offset into the list.
  const jumpToList = useCallback(() => {
    const element = scrollerRef.current;
    if (element && element.scrollTop > HERO_HEIGHT) element.scrollTop = HERO_HEIGHT;
  }, []);

  const stopEdit = useCallback(() => setEditingId(null), []);
  const filterOptions = [
    { value: 'all', label: t('shortcuts.allCategories') },
    ...categories.map((category) => ({ value: category.toLowerCase(), label: category })),
  ];
  const showSkeleton = loading && shortcuts.length === 0;

  return (
    <div className="settings-page">
      <SettingsPageHeader category={variant} />
      <div
        ref={scrollerRef}
        className="settings-vlist"
        onScroll={handleScroll}
        id={settingsRowDomId(`${variant}.list.apps`)}
      >
        <div className="settings-hero" style={{ height: HERO_HEIGHT }}>
          <img src={HERO_ICON[variant]} alt="" width={52} height={52} draggable={false} />
          <h2 className="settings-hero__title">{t(`sections.${variant}`)}</h2>
          <p className="settings-hero__subtitle">{t(`navigation.descriptions.${variant}`)}</p>
        </div>
        <div className="settings-vlist__toolbar" style={{ height: TOOLBAR_HEIGHT }}>
          <span className="flex min-w-0 items-center gap-2 text-[13px] font-medium">
            {t('applications.title')}
            {(refreshing || showSkeleton) && (
              <span
                className="flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground"
                role="status"
              >
                <Spinner size="small" />
                {t('applications.updating')}
              </span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search
                size={13}
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="search"
                className="h-8 w-56 pl-8"
                placeholder={t('shortcuts.searchPlaceholder')}
                aria-label={t('shortcuts.searchPlaceholder')}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  jumpToList();
                }}
              />
            </div>
            <SettingsSelect
              label={t('shortcuts.allCategories')}
              value={categoryFilter}
              onValueChange={(value) => {
                setCategoryFilter(value);
                jumpToList();
              }}
              options={filterOptions}
              className="h-8 sm:w-40"
            />
          </div>
        </div>
        {showSkeleton ? (
          <div className="settings-vlist__skeleton" aria-hidden="true">
            {Array.from({ length: SKELETON_ROWS }, (_, index) => (
              <div key={index} className="settings-vrow settings-vrow--skeleton">
                <span className="settings-skeleton settings-skeleton--icon" />
                <span
                  className="settings-skeleton"
                  style={{ width: `${30 + ((index * 17) % 35)}%` }}
                />
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {shortcuts.length === 0 ? t('shortcuts.noShortcuts') : t('shortcuts.noMatch')}
          </p>
        ) : (
          <div className="settings-vlist__spacer" style={{ height: rows.length * ROW_HEIGHT }}>
            {windowRows.map((shortcut, offset) => (
              <div
                key={shortcut.id}
                className="settings-vlist__item"
                style={{ top: (range.start + offset) * ROW_HEIGHT, height: ROW_HEIGHT }}
              >
                <AppRow
                  shortcut={shortcut}
                  iconSrc={getShortcutIconSrc(shortcut)}
                  editing={editingId === shortcut.id}
                  onStartEdit={setEditingId}
                  onStopEdit={stopEdit}
                  onSave={onSave}
                  onIconError={markIconFailed}
                  onHotkeyError={onHotkeyError}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
