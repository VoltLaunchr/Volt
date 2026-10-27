import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Slider } from '@/shared/components/ui/slider';
import { Switch } from '@/shared/components/ui/switch';
import type { SettingsCategory } from '../constants/settingsCategories';
import {
  getSettingsRow,
  getSettingsSection,
  settingsRowDomId,
  settingsSectionDomId,
} from '../registry/settingsRegistry';
import {
  SETTINGS_PLATFORM_LABELS,
  detectSettingsPlatform,
  isAvailableOn,
} from '../registry/platform';

/** Ids handed to a render-prop control so it can label itself without extra wiring. */
export interface SettingsRowControlIds {
  labelId: string;
  descriptionId: string;
}

interface SettingsSectionProps {
  /** Registry id: title and description are resolved from the registry. */
  sectionId: string;
  children: ReactNode;
  className?: string;
  /** Control aligned with the title (e.g. an "Add" button for a list section). */
  action?: ReactNode;
  /** Print the registry description under the title (off by default: rows explain themselves). */
  showDescription?: boolean;
}

/**
 * Titled card holding a stack of `SettingsRow`s. The section is a deep-link anchor
 * (`settingsSectionDomId`).
 */
export function SettingsSection({
  sectionId,
  children,
  className,
  action,
  showDescription = false,
}: SettingsSectionProps) {
  const { t } = useTranslation('settings');
  const definition = getSettingsSection(sectionId);
  const titleId = useId();
  return (
    <section
      id={settingsSectionDomId(sectionId)}
      aria-labelledby={definition ? titleId : undefined}
      className={cn('settings-section-block', className)}
    >
      {definition && (
        <header className="settings-section-block__header">
          <div className="min-w-0">
            <h2 id={titleId} className="settings-section-block__title">
              {t(definition.titleKey)}
            </h2>
            {showDescription && definition.descriptionKey && (
              <p className="settings-section-block__description">{t(definition.descriptionKey)}</p>
            )}
          </div>
          {action}
        </header>
      )}
      <div className="settings-section-block__card">{children}</div>
    </section>
  );
}

interface SettingsRowProps {
  /** Registry id: label and description are resolved from the registry. */
  rowId: string;
  /** Replaces the registry description when the hint depends on state (e.g. a disabled control). */
  description?: ReactNode;
  /** Control under the text on its own full-width line (previews, lists, long inputs). */
  stacked?: boolean;
  /** Control rendered on the right; a function receives the label/description ids. */
  children: ReactNode | ((ids: SettingsRowControlIds) => ReactNode);
  /** Associates the visible label with a native control (`<label for>`). */
  htmlFor?: string;
  className?: string;
  /** State badge shown next to the label (e.g. "Connected", "Pro"). */
  badge?: ReactNode;
  /** Decorative icon at the start of the row. */
  icon?: ReactNode;
}

const LABELLABLE_CONTROLS: readonly unknown[] = [Input, Slider, Switch];

/** One setting: label and description on the left, control on the right (min height 46px). */
export function SettingsRow({
  rowId,
  description: descriptionOverride,
  stacked = false,
  children,
  htmlFor,
  className,
  badge,
  icon,
}: SettingsRowProps) {
  const { t } = useTranslation('settings');
  const definition = getSettingsRow(rowId);
  const availability = definition?.availability;
  const unavailable = !isAvailableOn(availability, detectSettingsPlatform());
  const labelId = useId();
  const descriptionId = useId();
  const description =
    descriptionOverride ?? (definition?.descriptionKey ? t(definition.descriptionKey) : undefined);

  let control: ReactNode;
  if (typeof children === 'function') {
    control = children({ labelId, descriptionId });
  } else if (isValidElement(children) && LABELLABLE_CONTROLS.includes(children.type)) {
    control = cloneElement(children as ReactElement<Record<string, unknown>>, {
      'aria-labelledby': labelId,
      ...(description ? { 'aria-describedby': descriptionId } : {}),
    });
  } else {
    control = children;
  }

  return (
    <div
      id={settingsRowDomId(rowId)}
      aria-disabled={unavailable || undefined}
      className={cn(
        'settings-row',
        unavailable && 'settings-row--unavailable',
        stacked
          ? 'settings-row--stacked'
          : description
            ? 'settings-row--top'
            : 'settings-row--center',
        className
      )}
    >
      {icon && (
        <span className="settings-row__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <div className="settings-row__text">
        <div className="settings-row__heading">
          {htmlFor ? (
            <label id={labelId} htmlFor={htmlFor} className="settings-row__label">
              {definition ? t(definition.titleKey) : rowId}
            </label>
          ) : (
            <span id={labelId} className="settings-row__label">
              {definition ? t(definition.titleKey) : rowId}
            </span>
          )}
          {availability && (
            <Badge variant="outline" className="settings-row__badge">
              {t('availability.only', {
                platforms: availability.platforms
                  .map((platform) => SETTINGS_PLATFORM_LABELS[platform])
                  .join(' / '),
              })}
            </Badge>
          )}
          {badge}
        </div>
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

/** Quiet explanatory line at the top of a page or a section card. */
export function SettingsNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('settings-note', className)}>{children}</p>;
}

/** Dense list (folders, excluded apps...) attached under the row that owns it. */
export function SettingsList({
  children,
  empty,
  label,
}: {
  children?: ReactNode;
  /** Shown when there is no item. */
  empty?: ReactNode;
  label?: string;
}) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="settings-list" role="list" aria-label={label}>
      {hasItems ? children : empty ? <p className="settings-list__empty">{empty}</p> : null}
    </div>
  );
}

export function SettingsListItem({
  icon,
  label,
  title,
  onRemove,
  removeLabel,
}: {
  icon?: ReactNode;
  label: ReactNode;
  title?: string;
  onRemove: () => void;
  removeLabel: string;
}) {
  return (
    <div className="settings-list__item" role="listitem">
      {icon}
      <span className="settings-list__label" title={title}>
        {label}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={removeLabel}
        title={removeLabel}
        onClick={onRemove}
      >
        <X size={14} aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Activation state of the built-in plugin a Settings page configures. */
export interface SettingsPluginState {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

/**
 * Header of a plugin page: the activation switch of the plugin (registry section
 * `<page>.plugin`). It stays interactive when the rest of the page is greyed out.
 */
export function SettingsPluginSection({
  page,
  state,
  description,
}: {
  page: SettingsCategory;
  state: SettingsPluginState;
  /** Replaces the generic description (e.g. to say what keeps running while disabled). */
  description?: ReactNode;
}) {
  return (
    <SettingsSection sectionId={`${page}.plugin`}>
      <SettingsRow rowId={`${page}.plugin.enabled`} description={description}>
        <Switch checked={state.enabled} onCheckedChange={state.onToggle} />
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * Wraps what only works while its plugin is enabled: greyed out, not clickable and removed from
 * the tab order while disabled. Layout matches the page body (a column of sections).
 */
export function SettingsGate({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return (
    <div
      className={cn('settings-gate', !enabled && 'settings-gate--off')}
      inert={!enabled}
      data-gated={!enabled || undefined}
    >
      {children}
    </div>
  );
}
