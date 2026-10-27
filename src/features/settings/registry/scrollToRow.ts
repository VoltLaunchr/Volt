import { settingsRowDomId, settingsSectionDomId } from './settingsRegistry';

/** Duration of the highlight played on the row reached through a deep-link. */
export const SETTINGS_PULSE_MS = 2000;
export const SETTINGS_PULSE_CLASS = 'settings-pulse';

const pulseTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

function pulse(element: HTMLElement): void {
  const pending = pulseTimers.get(element);
  if (pending !== undefined) clearTimeout(pending);
  // Removing then re-adding the class restarts the CSS animation when it is already running.
  element.classList.remove(SETTINGS_PULSE_CLASS);
  void element.offsetWidth;
  element.classList.add(SETTINGS_PULSE_CLASS);
  pulseTimers.set(
    element,
    setTimeout(() => {
      element.classList.remove(SETTINGS_PULSE_CLASS);
      pulseTimers.delete(element);
    }, SETTINGS_PULSE_MS)
  );
}

function scrollToElement(element: HTMLElement | null): boolean {
  if (!element) return false;
  element.scrollIntoView({ block: 'center', behavior: 'auto' });
  pulse(element);
  return true;
}

/** Scrolls the row with the given registry id into view and pulses it. False if not rendered. */
export function scrollToRow(rowId: string, root: Document = document): boolean {
  return scrollToElement(root.getElementById(settingsRowDomId(rowId)));
}

/** Same as `scrollToRow` for a whole section. */
export function scrollToSection(sectionId: string, root: Document = document): boolean {
  return scrollToElement(root.getElementById(settingsSectionDomId(sectionId)));
}
