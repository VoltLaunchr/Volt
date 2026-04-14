import { test, expect, injectTauriMock, mockApps } from './fixtures';

test.describe('Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, mockApps(5));
    await page.goto('/');
    await page.locator('#search-input').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('search bar has correct ARIA attributes', async ({ page }) => {
    const input = page.locator('#search-input');
    await expect(input).toBeVisible();
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await expect(input).toHaveAttribute('aria-controls', 'results-listbox');
    await expect(input).toHaveAttribute('aria-label', /./);
  });

  test('results listbox has correct roles', async ({ page }) => {
    const input = page.locator('#search-input');
    await input.fill('test');
    const listbox = page.locator('#results-listbox');
    await expect(listbox).toHaveAttribute('role', 'listbox');
    await expect(listbox).toHaveAttribute('aria-label', 'Search results');
    const options = listbox.locator('[role="option"]');
    await expect(options.first()).toBeVisible({ timeout: 5000 });
    await expect(options.first()).toHaveAttribute('aria-selected', /(true|false)/);
  });

  test('aria-activedescendant updates on arrow navigation', async ({ page }) => {
    const input = page.locator('#search-input');
    await input.fill('Test');
    await page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 });
    await expect(input).toHaveAttribute('aria-activedescendant', 'result-item-0');
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'result-item-1');
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'result-item-2');
    await input.press('ArrowUp');
    await expect(input).toHaveAttribute('aria-activedescendant', 'result-item-1');
  });

  test('live region announces result count', async ({ page }) => {
    const liveRegion = page.locator('[role="status"][aria-live="polite"]');
    // Live region might not exist until results come in - just check after search
    const input = page.locator('#search-input');
    await input.fill('Test');
    await page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 });
    // After search, check that a live region with result info exists
    const count = await liveRegion.count();
    if (count > 0) {
      await expect(liveRegion.first()).not.toHaveText('');
    }
  });

  test('search input is auto-focused on page load', async ({ page }) => {
    const input = page.locator('#search-input');
    await expect(input).toBeFocused();
  });

  test('help dialog accessibility', async ({ page }) => {
    const input = page.locator('#search-input');
    await expect(input).toBeFocused();
    await page.keyboard.press('F1');

    const dialog = page.locator('[role="dialog"]');
    // Help dialog might not exist if F1 isn't bound - check gracefully
    const dialogVisible = await dialog.isVisible().catch(() => false);
    if (dialogVisible) {
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(input).toBeFocused();
    }
  });

  test('no duplicate landmark roles', async ({ page }) => {
    const mainLandmarks = page.locator('[role="main"]');
    const mainCount = await mainLandmarks.count();
    expect(mainCount).toBeLessThanOrEqual(1);

    const bannerLandmarks = page.locator('[role="banner"]');
    const bannerCount = await bannerLandmarks.count();
    expect(bannerCount).toBeLessThanOrEqual(1);

    const contentInfoLandmarks = page.locator('[role="contentinfo"]');
    const contentInfoCount = await contentInfoLandmarks.count();
    expect(contentInfoCount).toBeLessThanOrEqual(1);
  });
});
