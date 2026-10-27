import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SETTINGS_PULSE_CLASS,
  SETTINGS_PULSE_MS,
  scrollToRow,
  scrollToSection,
} from './scrollToRow';
import { settingsRowDomId, settingsSectionDomId } from './settingsRegistry';

function mount(domId: string): HTMLElement {
  const element = document.createElement('div');
  element.id = domId;
  element.scrollIntoView = vi.fn();
  document.body.appendChild(element);
  return element;
}

describe('scrollToRow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it('returns false and does nothing when the row is not rendered', () => {
    expect(scrollToRow('general.unknown.row')).toBe(false);
  });

  it('centers the row and pulses it for two seconds', () => {
    const row = mount(settingsRowDomId('general.search.hotkey'));
    expect(scrollToRow('general.search.hotkey')).toBe(true);
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
    expect(row.classList.contains(SETTINGS_PULSE_CLASS)).toBe(true);

    vi.advanceTimersByTime(SETTINGS_PULSE_MS - 1);
    expect(row.classList.contains(SETTINGS_PULSE_CLASS)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(row.classList.contains(SETTINGS_PULSE_CLASS)).toBe(false);
  });

  it('restarts the pulse window when the same row is targeted again', () => {
    const row = mount(settingsRowDomId('general.startup.openAtLogin'));
    scrollToRow('general.startup.openAtLogin');
    vi.advanceTimersByTime(1500);
    scrollToRow('general.startup.openAtLogin');
    vi.advanceTimersByTime(1500);
    expect(row.classList.contains(SETTINGS_PULSE_CLASS)).toBe(true);
    vi.advanceTimersByTime(500);
    expect(row.classList.contains(SETTINGS_PULSE_CLASS)).toBe(false);
  });

  it('targets sections through their own anchor', () => {
    const row = mount(settingsRowDomId('general.startup'));
    const section = mount(settingsSectionDomId('general.startup'));
    expect(scrollToSection('general.startup')).toBe(true);
    expect(section.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(row.scrollIntoView).not.toHaveBeenCalled();
  });
});
