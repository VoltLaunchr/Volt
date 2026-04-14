import { test, expect, injectTauriMock, MOCK_SETTINGS } from './fixtures';

test.describe('Search Flow', () => {
  test('shows search input on load', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await expect(searchInput).toBeFocused();
  });

  test('search input accepts text', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    await searchInput.fill('hello world');
    await expect(searchInput).toHaveValue('hello world');
  });

  test('clear button appears and clears on click', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    const clearButton = page.locator('.clear-button');
    await expect(clearButton).not.toBeVisible();
    await searchInput.fill('something');
    await expect(clearButton).toBeVisible();
    await clearButton.click();
    await expect(searchInput).toHaveValue('');
    await expect(clearButton).not.toBeVisible();
  });

  test('Escape clears the search input', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    await searchInput.fill('test query');
    await searchInput.press('Escape');
    await expect(searchInput).toHaveValue('');
  });

  test('calculator plugin shows result for 2+2', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    await searchInput.fill('2+2');
    const firstResult = page.locator('.result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.result-title').first()).toContainText('4');
  });

  test('calculator plugin shows result for complex expression', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    const searchInput = page.locator('#search-input');
    await searchInput.fill('10*5+3');
    const firstResult = page.locator('.result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.result-title').first()).toContainText('53');
  });

  test('calculator result has Calculator badge', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.locator('#search-input').fill('100/4');
    const firstResult = page.locator('.result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.result-badge').first()).toContainText('Calculator');
  });

  test('websearch activates with ? prefix', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.locator('#search-input').fill('?playwright testing');
    const firstResult = page.locator('.result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.result-title').first()).toContainText('playwright testing');
    await expect(page.locator('.result-badge').first()).toContainText('Web Search');
  });

  test('websearch activates with "search" prefix', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.locator('#search-input').fill('search how to use tauri');
    const firstResult = page.locator('.result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.result-title').first()).toContainText('how to use tauri');
  });

  test('search debounces rapid input', async ({ page }) => {
    // Custom mock that tracks search_streaming call count
    await page.addInitScript(({ settings }) => {
      (window as any).__SEARCH_CALL_COUNT__ = 0;
      const CALLBACKS: Record<number, (...args: unknown[]) => unknown> = {};
      let cbCounter = 0;

      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (cmd: string) => {
          if (typeof cmd === 'string' && cmd.startsWith('plugin:')) {
            if (cmd === 'plugin:event|listen') return cbCounter++;
            return null;
          }
          if (cmd === 'search_streaming') {
            (window as any).__SEARCH_CALL_COUNT__++;
            return null;
          }
          const handlers: Record<string, unknown> = {
            load_settings: settings, scan_applications: [], search_applications: [],
            search_files: [], get_launch_history: [], get_pinned_apps: [],
            get_frecency_scores: {}, get_frecency_suggestions: [], save_settings: null,
            start_indexing: null, get_default_index_folders: [], log_from_frontend: null,
            get_clipboard_history: [], get_quick_links: [], get_quicklinks: [],
            get_snippets: [], get_app_icon: null, launch_application: null,
            record_launch: null, get_window_position: { x: 0, y: 0 },
            get_enabled_extensions_sources: [], get_steam_games: [],
            start_clipboard_monitoring: null, hide_window: null,
          };
          return handlers[cmd] ?? null;
        },
        transformCallback: (cb: (...args: unknown[]) => unknown) => { const id = cbCounter++; CALLBACKS[id] = cb; (window as any)['_' + id] = cb; return id; },
        unregisterCallback: (id: number) => { delete CALLBACKS[id]; },
        metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        convertFileSrc: (p: string) => 'https://asset.localhost/' + encodeURIComponent(p),
      };
    }, { settings: MOCK_SETTINGS });
    await page.goto('/');
    await page.locator('#search-input').waitFor({ state: 'visible', timeout: 10000 });

    await page.locator('#search-input').pressSequentially('hello', { delay: 30 });
    await page.waitForTimeout(500);

    const callCount = await page.evaluate(() => (window as any).__SEARCH_CALL_COUNT__);
    expect(callCount).toBeLessThan(5);
  });

  test('results listbox has correct ARIA attributes', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.locator('#search-input').fill('2+2');
    const resultsList = page.locator('#results-listbox');
    await expect(resultsList).toBeVisible({ timeout: 5000 });
    await expect(resultsList).toHaveAttribute('role', 'listbox');
    await expect(resultsList).toHaveAttribute('aria-label', 'Search results');
  });

  test('result items have correct structure', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.locator('#search-input').fill('2+2');
    const firstResult = page.locator('.result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    await expect(firstResult.locator('.result-icon')).toBeVisible();
    await expect(firstResult.locator('.result-content')).toBeVisible();
    await expect(firstResult.locator('.result-title')).toBeVisible();
    await expect(firstResult.locator('.result-badge')).toBeVisible();
  });

  test('Ctrl+K clears the search input', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.locator('#search-input').fill('2+2');
    await expect(page.locator('.result-item').first()).toBeVisible({ timeout: 5000 });
    await page.locator('#search-input').press('Control+k');
    await expect(page.locator('#search-input')).toHaveValue('');
  });

  test('Tab autocompletes with selected result title', async ({ page }) => {
    await injectTauriMock(page);
    await page.goto('/');
    await page.locator('#search-input').fill('?hello');
    const firstResult = page.locator('.result-item').first();
    await expect(firstResult).toBeVisible({ timeout: 5000 });
    const resultTitle = await page.locator('.result-title').first().textContent();
    await page.locator('#search-input').press('Tab');
    await expect(page.locator('#search-input')).toHaveValue(resultTitle || '');
  });
});
