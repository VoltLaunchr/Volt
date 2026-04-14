import { test, expect, injectTauriMock } from './fixtures';

test.describe('App Smoke Test', () => {
  test('app loads and shows search bar', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await expect(searchInput).toBeFocused();
  });

  test('search bar accepts input', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    await searchInput.fill('calculator');
    await expect(searchInput).toHaveValue('calculator');
  });
});
