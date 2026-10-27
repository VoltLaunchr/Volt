import {
  cloneElement,
  isValidElement,
  memo,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Minus,
  Search,
  User,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import logo from '../../../assets/icons/logo.svg';
import { cn } from '@/lib/utils';
import { Badge } from '@/shared/components/ui/badge';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/shared/components/ui/input-group';
import { ScrollArea } from '@/shared/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { Input } from '@/shared/components/ui/input';
import { Slider } from '@/shared/components/ui/slider';
import { Switch } from '@/shared/components/ui/switch';
import { VoltIconTile } from '@/shared/icons/VoltIconTile';
import { hasVoltGlyph } from '@/shared/icons/glyphs';
import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_GLYPHS,
  SETTINGS_GROUPS,
  categoryTranslationKey,
  type CategoryItem,
  type SettingsCategory,
} from '../constants/settingsCategories';
import { detectSettingsPlatform } from '../registry/platform';
import { SETTINGS_REGISTRY } from '../registry/settingsRegistry';
import {
  buildSettingsSearchIndex,
  searchSettings,
  type SettingsSearchResult,
} from '../registry/settingsSearch';
import {
  SettingsPageContext,
  recallSettingsScroll,
  rememberSettingsScroll,
} from '../hooks/settingsPageContext';
import type { AccountSummary } from '../hooks/useAccountSummary';

/** The page title lives in the sidebar selection; the content starts directly with its rows. */
export function SettingsPageHeader({ category }: { category: SettingsCategory }) {
  const { t } = useTranslation('settings');
  return <h1 className="sr-only">{t(categoryTranslationKey(category))}</h1>;
}

export function SettingsBody({
  children,
  className,
  narrow = false,
}: {
  children: ReactNode;
  className?: string;
  /** Cap the width for dense, text-heavy pages; flat rows use the full width otherwise. */
  narrow?: boolean;
}) {
  const pageId = useContext(SettingsPageContext);
  const rootRef = useRef<HTMLDivElement>(null);
  // Restore the offset the user left this page at, and keep it up to date while scrolling.
  useLayoutEffect(() => {
    const viewport = rootRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]'
    );
    if (!viewport || pageId === null) return;
    viewport.scrollTop = recallSettingsScroll(pageId);
    const onScroll = () => rememberSettingsScroll(pageId, viewport.scrollTop);
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, [pageId]);
  return (
    <ScrollArea ref={rootRef} className="min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className={cn(
          'settings-body-content flex w-full flex-col gap-4',
          narrow && 'settings-body-content--narrow',
          className
        )}
      >
        {children}
      </div>
    </ScrollArea>
  );
}

/** Legacy section API (title passed as a prop); same flat look as the registry-driven section. */
export function SettingsSection({
  title,
  description,
  children,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('settings-section-block', className)}>
      <header className="settings-section-block__header flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="settings-section-block__title">{title}</h2>
          {description && <p className="settings-section-block__description">{description}</p>}
        </div>
        {action}
      </header>
      <div className="settings-section-block__card">{children}</div>
    </section>
  );
}

/** Legacy row API (label passed as a prop); same flat row as `SettingsRow`. */
export function SettingsField({
  label,
  description,
  children,
  htmlFor,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  const labelId = useId();
  const descriptionId = useId();
  const control =
    isValidElement(children) && [Input, Slider, Switch].includes(children.type as typeof Input)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          'aria-labelledby': labelId,
          ...(description ? { 'aria-describedby': descriptionId } : {}),
        })
      : children;
  return (
    <div
      className={cn(
        'settings-row',
        description ? 'settings-row--top' : 'settings-row--center',
        className
      )}
    >
      <div className="settings-row__text">
        <label id={labelId} htmlFor={htmlFor} className="settings-row__label">
          {label}
        </label>
        {description && (
          <p id={descriptionId} className="settings-row__description">
            {description}
          </p>
        )}
      </div>
      <div className="settings-row__control">{control}</div>
    </div>
  );
}

export function SettingsSwitchField({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <SettingsField label={label} description={description} htmlFor={id}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </SettingsField>
  );
}

export function SettingsSelect<T extends string | number>({
  value,
  options,
  onValueChange,
  label,
  id,
  disabled,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onValueChange: (value: T) => void;
  label: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        className={cn('w-full min-w-36 max-w-full sm:w-48', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Title bar: brand over the sidebar, history buttons over the content, window controls. */
export function SettingsTitleBar({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onMinimize,
  onClose,
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="settings-titlebar select-none" data-tauri-drag-region>
      <div className="settings-titlebar__brand pointer-events-none gap-2">
        <img src={logo} alt="" className="size-4 shrink-0" />
        <span>{t('titlebar')}</span>
      </div>
      <div className="settings-titlebar__nav no-drag">
        <button
          type="button"
          className="settings-titlebar__button"
          disabled={!canGoBack}
          onClick={onBack}
          aria-label={t('navigation.back')}
          title={t('navigation.back')}
        >
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="settings-titlebar__button"
          disabled={!canGoForward}
          onClick={onForward}
          aria-label={t('navigation.forward')}
          title={t('navigation.forward')}
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="settings-titlebar__controls no-drag">
        <button
          type="button"
          className="settings-titlebar__button"
          onClick={onMinimize}
          aria-label={t('navigation.minimize')}
        >
          <Minus size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="settings-titlebar__button settings-titlebar__button--close"
          onClick={onClose}
          aria-label={t('navigation.close')}
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

const NAV_GROUPS = SETTINGS_GROUPS.map((group) => ({
  id: group.id,
  categories: group.categories
    .map((id) => SETTINGS_CATEGORIES.find((category) => category.id === id))
    // The account card at the top of the sidebar is the entry point of the account page.
    .filter(
      (category): category is CategoryItem => category !== undefined && category.id !== 'account'
    ),
}));

const NAV_ITEM_SELECTOR = '[data-nav-item]';

function CategoryTile({ category }: { category: CategoryItem }) {
  if (category.iconSrc) {
    return (
      <img
        src={category.iconSrc}
        alt=""
        width={22}
        height={22}
        draggable={false}
        className="settings-nav__tile"
      />
    );
  }
  const glyph = SETTINGS_CATEGORY_GLYPHS[category.id];
  return hasVoltGlyph(glyph ?? '') ? (
    <VoltIconTile name={glyph} />
  ) : (
    <category.icon size={15} aria-hidden="true" />
  );
}

export type SettingsBadges = Partial<Record<SettingsCategory, string>>;

/** Memoized: only re-renders when the page, badges, account or version change, never on page edits. */
export const SettingsNavigation = memo(function SettingsNavigation({
  activeCategory,
  onSelect,
  onOpenResult,
  version,
  badges,
  account,
}: {
  activeCategory: SettingsCategory;
  onSelect: (category: SettingsCategory) => void;
  onOpenResult: (result: SettingsSearchResult) => void;
  version: string;
  badges: SettingsBadges;
  account: AccountSummary;
}) {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const listboxId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const index = useMemo(
    () =>
      buildSettingsSearchIndex(
        SETTINGS_CATEGORIES.map((category) => ({
          id: category.id,
          title: t(categoryTranslationKey(category.id)),
          description: t(`navigation.descriptions.${category.id}`),
        })),
        SETTINGS_REGISTRY,
        (key) => t(key),
        detectSettingsPlatform()
      ),
    [t]
  );
  const results = useMemo(() => searchSettings(index, query), [index, query]);
  const searching = query.trim().length > 0;
  const current = Math.min(highlighted, Math.max(results.length - 1, 0));
  const optionId = (position: number) => `${listboxId}-option-${position}`;
  const resetSearch = () => {
    setQuery('');
    setHighlighted(0);
  };
  const open = (result: SettingsSearchResult) => {
    onOpenResult(result);
    resetSearch();
  };
  const accountName = account.signedIn ? account.name : t('navigation.account.signedOut');
  const accountSub = account.signedIn ? account.email : t('navigation.account.label');
  return (
    <aside className="settings-sidebar bg-muted/30">
      <div className="settings-sidebar__top">
        <InputGroup className="h-8 bg-background/60">
          <InputGroupAddon>
            <Search size={14} aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={searchRef}
            type="search"
            role="combobox"
            aria-expanded={searching && results.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={searching && results.length > 0 ? optionId(current) : undefined}
            aria-label={t('navigation.searchLabel')}
            placeholder={t('navigation.searchPlaceholder')}
            value={query}
            className="text-xs"
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                resetSearch();
                event.stopPropagation();
                return;
              }
              if (searching) {
                if (event.key === 'ArrowDown' && results.length) {
                  event.preventDefault();
                  setHighlighted((current + 1) % results.length);
                } else if (event.key === 'ArrowUp' && results.length) {
                  event.preventDefault();
                  setHighlighted((current - 1 + results.length) % results.length);
                } else if (event.key === 'Enter' && results[current]) {
                  event.preventDefault();
                  open(results[current]);
                }
                return;
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                event.currentTarget
                  .closest('aside')
                  ?.querySelector<HTMLButtonElement>(NAV_ITEM_SELECTOR)
                  ?.focus();
              }
            }}
          />
          {query && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={t('navigation.clearSearch')}
                onClick={resetSearch}
              >
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        {!searching && (
          <button
            type="button"
            data-nav-item
            className="settings-account-card"
            aria-current={activeCategory === 'account' ? 'page' : undefined}
            aria-label={t('navigation.account.open')}
            onClick={() => onSelect('account')}
          >
            <span className="settings-account-card__avatar">
              {account.signedIn && account.name ? (
                account.name.charAt(0)
              ) : (
                <User size={15} aria-hidden="true" />
              )}
            </span>
            <span className="settings-account-card__text">
              <span className="settings-account-card__name">{accountName}</span>
              <span className="settings-account-card__sub">{accountSub}</span>
            </span>
          </button>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {searching ? (
          <div className="px-2.5 pb-5 pt-2">
            {results.length > 0 ? (
              <ul
                id={listboxId}
                role="listbox"
                aria-label={t('navigation.results.label')}
                className="flex flex-col gap-0.5"
              >
                {results.map((result, position) => (
                  <li
                    key={`${result.kind}:${result.id}`}
                    id={optionId(position)}
                    role="option"
                    aria-selected={position === current}
                    className={cn(
                      'cursor-pointer rounded-lg px-2 py-1.5 text-xs transition-colors duration-100',
                      position === current ? 'bg-foreground/10' : 'hover:bg-foreground/5'
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setHighlighted(position)}
                    onClick={() => open(result)}
                  >
                    <span className="block truncate font-medium">{result.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {result.kind === 'page' ? t('navigation.results.page') : result.trail}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-2 py-4 text-xs text-muted-foreground" role="status">
                {t('navigation.noResults')}
              </p>
            )}
          </div>
        ) : (
          <nav
            aria-label={t('navigation.label')}
            className="settings-nav"
            onKeyDown={(event) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
              const items = Array.from(
                event.currentTarget
                  .closest('aside')
                  ?.querySelectorAll<HTMLButtonElement>(NAV_ITEM_SELECTOR) ?? []
              );
              const position = items.indexOf(event.target as HTMLButtonElement);
              if (position < 0) return;
              event.preventDefault();
              if (event.key === 'ArrowUp' && position === 0) {
                searchRef.current?.focus();
                return;
              }
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (position + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                      items.length;
              items[next]?.focus();
            }}
          >
            {NAV_GROUPS.map((group) => (
              <section
                key={group.id}
                aria-label={t(`navigation.groups.${group.id}`)}
                className="settings-nav__group"
              >
                {group.categories.map((category) => {
                  const label = t(categoryTranslationKey(category.id));
                  const badge = badges[category.id];
                  return (
                    <button
                      type="button"
                      key={category.id}
                      data-nav-item
                      className="settings-nav__item"
                      aria-current={activeCategory === category.id ? 'page' : undefined}
                      onClick={() => onSelect(category.id)}
                      title={label}
                    >
                      <CategoryTile category={category} />
                      <span className="settings-nav__label">{label}</span>
                      {badge && <span className="settings-nav__badge">{badge}</span>}
                    </button>
                  );
                })}
              </section>
            ))}
          </nav>
        )}
      </ScrollArea>
      <div className="settings-sidebar__footer">
        <span>{t('navigation.workspace')}</span>
        {version && (
          <Badge variant="outline" className="text-[10px] font-normal">
            v{version}
          </Badge>
        )}
      </div>
    </aside>
  );
});

export function SettingsStatus({
  title,
  children,
  kind = 'neutral',
  action,
}: {
  title?: string;
  children: ReactNode;
  kind?: 'neutral' | 'error' | 'success';
  action?: ReactNode;
}) {
  const Icon = kind === 'error' ? AlertCircle : kind === 'success' ? CheckCircle2 : null;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex shrink-0 flex-wrap items-center gap-3 rounded-lg px-3 py-2.5',
        kind === 'error'
          ? 'bg-destructive/10'
          : kind === 'success'
            ? 'bg-success/10'
            : 'bg-foreground/[0.04]'
      )}
    >
      {Icon && (
        <Icon size={16} className={kind === 'error' ? 'text-destructive' : 'text-success'} />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        {title && <p className="text-[13px] font-medium text-foreground">{title}</p>}
        <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
      {action}
    </div>
  );
}
