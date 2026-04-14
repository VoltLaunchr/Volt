import { test, expect, injectTauriMock, mockApps } from './fixtures';

const MOCK_APPS = mockApps(5);

async function typeAndWaitForResults(page: import('@playwright/test').Page, query: string) {
  const input = page.locator('#search-input');
  await input.fill(query);
  await page.locator('[role="option"]').first().waitFor({ state: 'visible', timeout: 5000 });
}

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await injectTauriMock(page, MOCK_APPS);
    await page.goto('/');
    await page.locator('#search-input').waitFor({ state: 'visible', timeout: 10000 });
  });

  test('first result is auto-selected after search', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');
  });

  test('ArrowDown moves selection to next result', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    await page.locator('#search-input').press('ArrowDown');
    const secondOption = page.locator('[role="option"]').nth(1);
    await expect(secondOption).toHaveAttribute('aria-selected', 'true');
  });

  test('ArrowUp moves selection to previous result', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('ArrowUp');
    const secondOption = page.locator('[role="option"]').nth(1);
    await expect(secondOption).toHaveAttribute('aria-selected', 'true');
  });

  test('ArrowDown at last result does NOT wrap', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    const optionCount = await page.locator('[role="option"]').count();
    for (let i = 0; i < optionCount + 3; i++) {
      await input.press('ArrowDown');
    }
    const lastOption = page.locator('[role="option"]').nth(optionCount - 1);
    await expect(lastOption).toHaveAttribute('aria-selected', 'true');
  });

  test('ArrowUp at first result does NOT wrap', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('ArrowUp');
    await input.press('ArrowUp');
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');
  });

  test('Home key jumps to first result', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('Home');
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');
  });

  test('End key jumps to last result', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    const optionCount = await page.locator('[role="option"]').count();
    await input.press('End');
    const lastOption = page.locator('[role="option"]').nth(optionCount - 1);
    await expect(lastOption).toHaveAttribute('aria-selected', 'true');
  });

  test('PageDown moves selection down by 5', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    const optionCount = await page.locator('[role="option"]').count();
    await input.press('PageDown');
    const expectedIndex = Math.min(5, optionCount - 1);
    const targetOption = page.locator('[role="option"]').nth(expectedIndex);
    await expect(targetOption).toHaveAttribute('aria-selected', 'true');
  });

  test('PageUp moves selection up by 5', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('End');
    await input.press('PageUp');
    const firstOption = page.locator('[role="option"]').first();
    await expect(firstOption).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter key launches the selected result', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('ArrowDown');
    await input.press('Enter');
    const calls = await page.evaluate(() => (window as any).__TAURI_INVOKE_CALLS__);
    const launchCall = calls.find((c: any) => c.cmd === 'launch_application');
    expect(launchCall).toBeTruthy();
  });

  test('Escape clears search input', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('Escape');
    await expect(input).toHaveValue('');
  });

  test('Tab autocompletes with selected result title', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('Tab');
    await expect(input).toHaveValue('Test App 1');
  });

  test('Tab autocompletes with current selection', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('ArrowDown');
    await input.press('ArrowDown');
    await input.press('Tab');
    await expect(input).toHaveValue('Test App 3');
  });

  test('Alt+number quick-selects results', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('Alt+2');
    const calls = await page.evaluate(() => (window as any).__TAURI_INVOKE_CALLS__);
    const launchCall = calls.find((c: any) => c.cmd === 'launch_application');
    expect(launchCall).toBeTruthy();
  });

  test('Alt+number beyond result count does nothing', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    const optionCount = await page.locator('[role="option"]').count();
    await page.evaluate(() => { (window as any).__TAURI_INVOKE_CALLS__ = []; });
    if (optionCount < 9) {
      await input.press('Alt+9');
      const calls = await page.evaluate(() => (window as any).__TAURI_INVOKE_CALLS__);
      const launchCall = calls.find((c: any) => c.cmd === 'launch_application');
      expect(launchCall).toBeUndefined();
    }
  });

  test('Ctrl+K clears search input', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await input.press('Control+k');
    await expect(input).toHaveValue('');
  });

  test('search input is focused on load', async ({ page }) => {
    const input = page.locator('#search-input');
    await expect(input).toBeFocused();
  });

  test('aria-activedescendant updates with selection', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const input = page.locator('#search-input');
    await expect(input).toHaveAttribute('aria-activedescendant', 'result-item-0');
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'result-item-1');
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'result-item-2');
  });

  test('results listbox has correct ARIA attributes', async ({ page }) => {
    await typeAndWaitForResults(page, 'Test');
    const listbox = page.locator('[role="listbox"]');
    await expect(listbox).toHaveAttribute('aria-label', 'Search results');
    await expect(listbox).toHaveAttribute('id', 'results-listbox');
  });
});
