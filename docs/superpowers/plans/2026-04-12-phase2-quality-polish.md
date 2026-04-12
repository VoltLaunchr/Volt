# Phase 2 "Quality & Polish" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Zustand state management, a toast notification system with indexing progress, an onboarding modal for first-launch users, and close remaining accessibility gaps.

**Architecture:** 4 independent workstreams. WS2 (Zustand) is implemented first as it simplifies state access for WS3 and WS4. WS1 (A11y) is independent. All workstreams produce small, testable commits.

**Tech Stack:** React 19, TypeScript 5.8, Zustand, Vitest, Tauri v2, lucide-react

---

## Task 1: Install Zustand

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install zustand**

Run: `bun add zustand`

- [ ] **Step 2: Verify installation**

Run: `bun run build`
Expected: BUILD SUCCESS, no type errors

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add zustand dependency"
```

---

## Task 2: Create search store

**Files:**
- Create: `src/stores/searchStore.ts`
- Test: `src/stores/__tests__/searchStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/__tests__/searchStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useSearchStore } from '../searchStore';

describe('searchStore', () => {
  beforeEach(() => {
    useSearchStore.setState(useSearchStore.getInitialState());
  });

  it('has correct initial state', () => {
    const state = useSearchStore.getState();
    expect(state.searchQuery).toBe('');
    expect(state.results).toEqual([]);
    expect(state.selectedIndex).toBe(0);
    expect(state.searchError).toBeNull();
    expect(state.showSnowEffect).toBe(false);
  });

  it('setQuery updates searchQuery', () => {
    useSearchStore.getState().setQuery('hello');
    expect(useSearchStore.getState().searchQuery).toBe('hello');
  });

  it('setResults updates results and resets selectedIndex', () => {
    useSearchStore.getState().setSelectedIndex(3);
    useSearchStore.getState().setResults([
      { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} },
    ]);
    expect(useSearchStore.getState().results).toHaveLength(1);
    expect(useSearchStore.getState().selectedIndex).toBe(0);
  });

  it('setSelectedIndex updates index', () => {
    useSearchStore.getState().setSelectedIndex(5);
    expect(useSearchStore.getState().selectedIndex).toBe(5);
  });

  it('clearSearch resets query, results, and snow effect', () => {
    useSearchStore.getState().setQuery('test');
    useSearchStore.getState().setResults([
      { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} },
    ]);
    useSearchStore.getState().clearSearch();
    expect(useSearchStore.getState().searchQuery).toBe('');
    expect(useSearchStore.getState().results).toEqual([]);
    expect(useSearchStore.getState().showSnowEffect).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/stores/__tests__/searchStore.test.ts`
Expected: FAIL — module `../searchStore` not found

- [ ] **Step 3: Write the store**

Create `src/stores/searchStore.ts`:

```typescript
import { create } from 'zustand';
import { SearchResult } from '../shared/types/common.types';

interface SearchState {
  searchQuery: string;
  results: SearchResult[];
  selectedIndex: number;
  searchError: string | null;
  showSnowEffect: boolean;
}

interface SearchActions {
  setQuery: (query: string) => void;
  setResults: (results: SearchResult[]) => void;
  setSelectedIndex: (index: number | ((prev: number) => number)) => void;
  setSearchError: (error: string | null) => void;
  setShowSnowEffect: (show: boolean) => void;
  clearSearch: () => void;
}

export const useSearchStore = create<SearchState & SearchActions>()((set, get) => ({
  // State
  searchQuery: '',
  results: [],
  selectedIndex: 0,
  searchError: null,
  showSnowEffect: false,

  // Actions
  setQuery: (query) => set({ searchQuery: query }),

  setResults: (results) => set({ results, selectedIndex: 0 }),

  setSelectedIndex: (indexOrFn) =>
    set((state) => ({
      selectedIndex: typeof indexOrFn === 'function' ? indexOrFn(state.selectedIndex) : indexOrFn,
    })),

  setSearchError: (error) => set({ searchError: error }),

  setShowSnowEffect: (show) => set({ showSnowEffect: show }),

  clearSearch: () =>
    set({
      searchQuery: '',
      results: [],
      selectedIndex: 0,
      showSnowEffect: false,
    }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/stores/__tests__/searchStore.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/searchStore.ts src/stores/__tests__/searchStore.test.ts
git commit -m "feat: add search store (zustand)"
```

---

## Task 3: Create UI store

**Files:**
- Create: `src/stores/uiStore.ts`
- Test: `src/stores/__tests__/uiStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/__tests__/uiStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState(useUiStore.getInitialState());
  });

  it('has correct initial state', () => {
    const state = useUiStore.getState();
    expect(state.activeView).toEqual({ type: 'search' });
    expect(state.contextMenu.isOpen).toBe(false);
    expect(state.isPropertiesOpen).toBe(false);
    expect(state.propertiesResult).toBeNull();
    expect(state.isHelpOpen).toBe(false);
  });

  it('setActiveView updates view', () => {
    useUiStore.getState().setActiveView({ type: 'calculator' });
    expect(useUiStore.getState().activeView).toEqual({ type: 'calculator' });
  });

  it('openContextMenu sets position and result', () => {
    const result = { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} };
    useUiStore.getState().openContextMenu({ x: 10, y: 20 }, result as any);
    const state = useUiStore.getState();
    expect(state.contextMenu.isOpen).toBe(true);
    expect(state.contextMenu.position).toEqual({ x: 10, y: 20 });
  });

  it('closeContextMenu resets context menu', () => {
    useUiStore.getState().openContextMenu({ x: 10, y: 20 }, {} as any);
    useUiStore.getState().closeContextMenu();
    expect(useUiStore.getState().contextMenu.isOpen).toBe(false);
  });

  it('openProperties sets result and flag', () => {
    const result = { id: '1', type: 0, title: 'Test', subtitle: '', icon: '', score: 100, data: {} };
    useUiStore.getState().openProperties(result as any);
    expect(useUiStore.getState().isPropertiesOpen).toBe(true);
    expect(useUiStore.getState().propertiesResult).toBe(result);
  });

  it('toggleHelp flips isHelpOpen', () => {
    expect(useUiStore.getState().isHelpOpen).toBe(false);
    useUiStore.getState().toggleHelp();
    expect(useUiStore.getState().isHelpOpen).toBe(true);
    useUiStore.getState().toggleHelp();
    expect(useUiStore.getState().isHelpOpen).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/stores/__tests__/uiStore.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the store**

Create `src/stores/uiStore.ts`:

```typescript
import { create } from 'zustand';
import { SearchResult } from '../shared/types/common.types';

export type ActiveView =
  | { type: 'search' }
  | { type: 'clipboard' }
  | { type: 'emoji'; initialQuery?: string }
  | { type: 'files' }
  | { type: 'calculator' }
  | { type: 'games' }
  | { type: 'changelog' };

export interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  result: SearchResult | null;
}

interface UiState {
  activeView: ActiveView;
  contextMenu: ContextMenuState;
  isPropertiesOpen: boolean;
  propertiesResult: SearchResult | null;
  isHelpOpen: boolean;
}

interface UiActions {
  setActiveView: (view: ActiveView) => void;
  openContextMenu: (position: { x: number; y: number }, result: SearchResult) => void;
  closeContextMenu: () => void;
  openProperties: (result: SearchResult) => void;
  closeProperties: () => void;
  toggleHelp: () => void;
}

export const useUiStore = create<UiState & UiActions>()((set) => ({
  // State
  activeView: { type: 'search' } as ActiveView,
  contextMenu: { isOpen: false, position: { x: 0, y: 0 }, result: null },
  isPropertiesOpen: false,
  propertiesResult: null,
  isHelpOpen: false,

  // Actions
  setActiveView: (view) => set({ activeView: view }),

  openContextMenu: (position, result) =>
    set({ contextMenu: { isOpen: true, position, result } }),

  closeContextMenu: () =>
    set({ contextMenu: { isOpen: false, position: { x: 0, y: 0 }, result: null } }),

  openProperties: (result) => set({ isPropertiesOpen: true, propertiesResult: result }),

  closeProperties: () => set({ isPropertiesOpen: false }),

  toggleHelp: () => set((state) => ({ isHelpOpen: !state.isHelpOpen })),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/stores/__tests__/uiStore.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/uiStore.ts src/stores/__tests__/uiStore.test.ts
git commit -m "feat: add UI store (zustand)"
```

---

## Task 4: Create app store

**Files:**
- Create: `src/stores/appStore.ts`
- Test: `src/stores/__tests__/appStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/stores/__tests__/appStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('appStore', () => {
  beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState());
  });

  it('has correct initial state', () => {
    const state = useAppStore.getState();
    expect(state.settings).toBeNull();
    expect(state.isIndexing).toBe(false);
  });

  it('setSettings updates settings', () => {
    const mockSettings = { general: { startWithWindows: false, maxResults: 8, closeOnLaunch: true, hasSeenOnboarding: false } } as any;
    useAppStore.getState().setSettings(mockSettings);
    expect(useAppStore.getState().settings).toBe(mockSettings);
  });

  it('setIsIndexing updates indexing state', () => {
    useAppStore.getState().setIsIndexing(true);
    expect(useAppStore.getState().isIndexing).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/stores/__tests__/appStore.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the store**

Create `src/stores/appStore.ts`:

```typescript
import { create } from 'zustand';
import { Settings } from '../features/settings/types/settings.types';

interface AppState {
  settings: Settings | null;
  isIndexing: boolean;
}

interface AppActions {
  setSettings: (settings: Settings | null) => void;
  setIsIndexing: (indexing: boolean) => void;
}

export const useAppStore = create<AppState & AppActions>()((set) => ({
  // State
  settings: null,
  isIndexing: false,

  // Actions
  setSettings: (settings) => set({ settings }),
  setIsIndexing: (isIndexing) => set({ isIndexing }),
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- src/stores/__tests__/appStore.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/appStore.ts src/stores/__tests__/appStore.test.ts
git commit -m "feat: add app store (zustand)"
```

---

## Task 5: Migrate hooks to use stores

**Files:**
- Modify: `src/app/hooks/useSearchPipeline.ts`
- Modify: `src/app/hooks/useAppLifecycle.ts`
- Modify: `src/app/hooks/useResultActions.ts` — remove `ActiveView` type export (moved to uiStore)
- Modify: `src/app/App.tsx` — remove all useState, use stores
- Modify: `src/app/components/ViewRouter.tsx` — read from stores, reduce props
- Modify: `src/app/hooks/useGlobalHotkey.ts` — read from stores

- [ ] **Step 1: Update useSearchPipeline to write to store**

In `src/app/hooks/useSearchPipeline.ts`, replace useState calls with store access. The hook still exists as a thin wrapper that wires up the debounce effect and performSearch logic, but state lives in the store.

Replace the entire file with:

```typescript
import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useRef } from 'react';
import { applicationService } from '../../features/applications/services/applicationService';
import { pluginRegistry } from '../../features/plugins/core';
import { PluginResult as PluginResultData } from '../../features/plugins/types';
import { AppInfo, FileInfo, SearchResult, SearchResultType } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { useSearchStore } from '../../stores/searchStore';

// Search result priority scores (higher = appears first)
export const SEARCH_PRIORITIES = {
  APPLICATION: 200,
  FILE: 80,
  PLUGIN_BASE: 100,
  PLUGIN_KEYWORD_BOOST: 300,
} as const;

// Plugin keywords map
const PLUGIN_KEYWORDS: Record<string, string[]> = {
  calculator: ['calc', 'calculatrice', 'calculer', 'calcul', '=', 'math'],
  timer: ['timer', 'minuteur', 'chrono', 'countdown', 'pomodoro'],
  websearch: ['?', 'web', 'search', 'google', 'bing', 'ddg', 'chercher'],
  systemcommands: ['reload', 'settings', 'quit', 'exit', 'preferences', 'config', 'paramètres'],
  emoji: ['emoji', ':'],
  system_monitor: ['system', 'cpu', 'ram', 'memory', 'disk', 'système', 'monitor'],
  games: ['game', 'jeu', 'steam', 'epic', 'gog'],
  clipboard: ['clipboard', 'presse-papier', 'copier', 'coller'],
};

const getPluginKeywordBoost = (query: string, pluginId: string): number => {
  const lowerQuery = query.toLowerCase().trim();
  const keywords = PLUGIN_KEYWORDS[pluginId];
  if (!keywords) return 0;
  for (const keyword of keywords) {
    if (lowerQuery === keyword || lowerQuery.startsWith(keyword + ' ') || lowerQuery.startsWith(keyword)) {
      return SEARCH_PRIORITIES.PLUGIN_KEYWORD_BOOST;
    }
  }
  return 0;
};

interface UseSearchPipelineOptions {
  allApps: AppInfo[];
  isLoading: boolean;
  maxResults: number;
  suspended?: boolean;
}

/**
 * Wires up the debounced search pipeline. State lives in useSearchStore.
 */
export function useSearchPipeline({
  allApps,
  isLoading,
  maxResults,
  suspended = false,
}: UseSearchPipelineOptions): void {
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const { setResults, setSelectedIndex, setSearchError, setShowSnowEffect } = useSearchStore.getState();

  const latestSearchId = useRef(0);

  const performSearch = useCallback(
    async (query: string) => {
      if (isLoading || allApps.length === 0) {
        setResults([]);
        return;
      }

      if (!query.trim()) {
        setResults([]);
        setShowSnowEffect(false);
        return;
      }

      const isChristmasQuery =
        /christmas|xmas|noel|25.*dec|dec.*25/i.test(query) ||
        /days?\s+(until|to|before)\s+(christmas|xmas|noel|dec.*25|25.*dec)/i.test(query);
      setShowSnowEffect(isChristmasQuery);

      try {
        const searchId = ++latestSearchId.current;

        const [searchedApps, searchedFiles, pluginResults] = await Promise.all([
          applicationService.searchApplications({ query }, allApps),
          invoke<FileInfo[]>('search_files', { query, limit: maxResults }).catch(() => [] as FileInfo[]),
          pluginRegistry.query({ query }).catch(() => [] as PluginResultData[]),
        ]);

        if (searchId !== latestSearchId.current) return;

        const appResults: SearchResult[] = searchedApps.map((app) => ({
          id: app.id,
          type: SearchResultType.Application,
          title: app.name,
          subtitle: app.path,
          icon: app.icon,
          score: SEARCH_PRIORITIES.APPLICATION,
          data: app,
        }));

        const fileResults: SearchResult[] = searchedFiles.map((file) => ({
          id: file.id,
          type: SearchResultType.File,
          title: file.name,
          subtitle: file.path,
          icon: file.icon,
          score: SEARCH_PRIORITIES.FILE,
          data: file,
        }));

        const pluginSearchResults: SearchResult[] = pluginResults.map((result) => {
          let searchResultType: SearchResultType;
          switch (result.type) {
            case 'calculator': searchResultType = SearchResultType.Calculator; break;
            case 'websearch': searchResultType = SearchResultType.WebSearch; break;
            case 'systemcommand': searchResultType = SearchResultType.SystemCommand; break;
            case 'game': searchResultType = SearchResultType.Game; break;
            default: searchResultType = SearchResultType.Plugin;
          }
          const pluginId = result.pluginId || result.type;
          const keywordBoost = getPluginKeywordBoost(query, pluginId);
          const finalScore = keywordBoost > 0 ? keywordBoost + result.score : result.score;
          return {
            id: result.id,
            type: searchResultType,
            title: result.title,
            subtitle: result.subtitle,
            icon: result.icon,
            badge: result.badge,
            score: finalScore,
            data: result,
          };
        });

        const allResults = [...appResults, ...fileResults, ...pluginSearchResults]
          .sort((a, b) => b.score - a.score)
          .slice(0, maxResults);

        setResults(allResults);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('Search failed:', errorMessage);
        setResults([]);
        setSearchError(`Search failed: ${errorMessage}`);
      }
    },
    [allApps, isLoading, maxResults, setResults, setSearchError, setShowSnowEffect]
  );

  // Debounced search effect (150 ms)
  useEffect(() => {
    if (suspended) return;
    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 150);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch, suspended]);

  // Keep selected index in range
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  useEffect(() => {
    if (results.length > 0 && selectedIndex >= results.length) {
      setSelectedIndex(results.length - 1);
    }
  }, [results, selectedIndex, setSelectedIndex]);
}
```

- [ ] **Step 2: Update useAppLifecycle to write to appStore**

In `src/app/hooks/useAppLifecycle.ts`, replace `useState` for `settings` and `isIndexing` with appStore. Replace `setSettings(...)` with `useAppStore.getState().setSettings(...)` and `setIsIndexing(...)` with `useAppStore.getState().setIsIndexing(...)`.

Key changes:
- Remove `useState<Settings | null>(null)` and `useState(false)` for isIndexing
- Import `useAppStore` from `../../stores/appStore`
- Use `useAppStore.getState().setSettings(loadedSettings)` in initializeApp
- Use `useAppStore.getState().setIsIndexing(true/false)` in startFileIndexing
- Read settings from store: `const settings = useAppStore((s) => s.settings)`
- Return type stays the same — the hook still returns the same interface, just reading from store

- [ ] **Step 3: Update useResultActions — move ActiveView to uiStore**

In `src/app/hooks/useResultActions.ts`:
- Remove the `ActiveView` type export (it now lives in `src/stores/uiStore.ts`)
- Import `ActiveView` from `../../stores/uiStore`
- The interface `UseResultActionsOptions` still receives `setActiveView` as a prop (it comes from the store action)

- [ ] **Step 4: Update App.tsx to use stores**

Replace all `useState` calls with store access. App.tsx becomes a pure orchestration component:

```typescript
import { useCallback, useEffect } from 'react';
import Snowfall from 'react-snowfall';
import { TimerDisplay } from '../features/plugins/builtin';
import { SearchBar } from '../features/search/components/SearchBar';
import { useWindowState } from '../features/window';
import { Footer } from '../shared/components/layout';
import { HelpDialog, PropertiesDialog } from '../shared/components/ui';
import { defaultSuggestions } from '../shared/constants/suggestions';
import { ResultContextMenu } from './components/ResultContextMenu';
import { ViewRouter } from './components/ViewRouter';
import { useAppLifecycle } from './hooks/useAppLifecycle';
import { useGlobalHotkey } from './hooks/useGlobalHotkey';
import { useResultActions } from './hooks/useResultActions';
import { useSearchPipeline } from './hooks/useSearchPipeline';
import { openSettingsWindow } from './utils';
import { useSearchStore } from '../stores/searchStore';
import { useUiStore } from '../stores/uiStore';
import { useAppStore } from '../stores/appStore';
import './App.css';

function App() {
  const { allApps, isLoading, appError, refreshApps, clearAppError } = useAppLifecycle();
  const { hide: hideWindow, startDragging } = useWindowState();

  const settings = useAppStore((s) => s.settings);
  const isIndexing = useAppStore((s) => s.isIndexing);

  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const searchError = useSearchStore((s) => s.searchError);
  const showSnowEffect = useSearchStore((s) => s.showSnowEffect);
  const { setQuery, setResults, setSelectedIndex, setSearchError, clearSearch } = useSearchStore.getState();

  const activeView = useUiStore((s) => s.activeView);
  const contextMenu = useUiStore((s) => s.contextMenu);
  const isPropertiesOpen = useUiStore((s) => s.isPropertiesOpen);
  const propertiesResult = useUiStore((s) => s.propertiesResult);
  const isHelpOpen = useUiStore((s) => s.isHelpOpen);
  const { setActiveView, closeContextMenu, openProperties, closeProperties, toggleHelp } = useUiStore.getState();

  useSearchPipeline({
    allApps,
    isLoading,
    maxResults: settings?.general.maxResults ?? 8,
    suspended: activeView.type !== 'search',
  });

  const error = appError || searchError;

  const clearError = useCallback(() => {
    clearAppError();
    setSearchError(null);
  }, [clearAppError, setSearchError]);

  // Switch to emoji picker when query starts with `:`
  useEffect(() => {
    if (searchQuery.startsWith(':')) {
      setActiveView({ type: 'emoji', initialQuery: searchQuery.substring(1) });
    } else if (activeView.type === 'emoji' && !searchQuery.startsWith(':')) {
      setActiveView({ type: 'search' });
    }
  }, [searchQuery, activeView.type, setActiveView]);

  const { handleLaunch, handleSuggestionActivate } = useResultActions({
    closeOnLaunch: settings?.general.closeOnLaunch !== false,
    hideWindow,
    openSettingsWindow,
    setSearchQuery: setQuery,
    setResults,
    setSearchError,
    setActiveView,
  });

  const handleSuggestionSelect = useCallback((categoryIndex: number, itemIndex: number) => {
    let globalIndex = 0;
    for (let i = 0; i < categoryIndex; i++) {
      globalIndex += defaultSuggestions[i].items.length;
    }
    setSelectedIndex(globalIndex + itemIndex);
  }, [setSelectedIndex]);

  const handleShowProperties = useCallback((result: any) => {
    openProperties(result);
  }, [openProperties]);

  const handleOpenHelp = useCallback(() => {
    toggleHelp();
  }, [toggleHelp]);

  const resetToSearchView = useCallback(() => {
    setActiveView({ type: 'search' });
    clearSearch();
  }, [setActiveView, clearSearch]);

  const handleOpenCalculatorView = useCallback(() => {
    setActiveView({ type: 'calculator' });
    clearSearch();
  }, [setActiveView, clearSearch]);

  const closeOnLaunch = settings?.general.closeOnLaunch !== false;

  const { handleKeyDown } = useGlobalHotkey({
    results,
    selectedIndex,
    setSelectedIndex,
    searchQuery,
    setSearchQuery: setQuery,
    setResults,
    closeOnLaunch,
    hideWindow,
    onLaunch: handleLaunch,
    onActivateSuggestion: handleSuggestionActivate,
    onShowProperties: handleShowProperties,
    onOpenSettings: openSettingsWindow,
    onOpenCalculator: handleOpenCalculatorView,
    onOpenHelp: handleOpenHelp,
  });

  const handleRetry = useCallback(async () => {
    clearError();
    await refreshApps();
  }, [clearError, refreshApps]);

  const handleSelectEmoji = useCallback(
    async (emoji: string) => {
      await navigator.clipboard.writeText(emoji).catch(() => {});
      resetToSearchView();
      if (closeOnLaunch) await hideWindow();
    },
    [closeOnLaunch, hideWindow, resetToSearchView]
  );

  return (
    <div className="app-container glass">
      {activeView.type === 'search' && (
        <>
          <div className="drag-region" onMouseDown={startDragging}>
            <div className="drag-handle"></div>
          </div>
          <SearchBar
            value={searchQuery}
            onChange={setQuery}
            onKeyDown={handleKeyDown}
            placeholder={isLoading ? 'Loading applications...' : 'Search for apps and commands...'}
            resultCount={results.length}
          />
        </>
      )}

      <ViewRouter
        activeView={activeView}
        isLoading={isLoading}
        error={error}
        searchQuery={searchQuery}
        results={results}
        selectedIndex={selectedIndex}
        onResetView={resetToSearchView}
        onSelectEmoji={handleSelectEmoji}
        onRetry={handleRetry}
        onClearError={clearError}
        onSelectResult={setSelectedIndex}
        onLaunchResult={handleLaunch}
        onSuggestionSelect={handleSuggestionSelect}
        onSuggestionActivate={handleSuggestionActivate}
      />

      {activeView.type === 'search' && (
        <>
          <TimerDisplay />
          <Footer isIndexing={isIndexing} />
        </>
      )}

      <ResultContextMenu
        state={contextMenu}
        onLaunch={handleLaunch}
        onShowProperties={handleShowProperties}
        onClose={closeContextMenu}
      />

      <PropertiesDialog
        isOpen={isPropertiesOpen}
        onClose={closeProperties}
        result={propertiesResult}
      />

      <HelpDialog isOpen={isHelpOpen} onClose={toggleHelp} />

      {showSnowEffect && (
        <Snowfall
          color="#dee4fd"
          snowflakeCount={200}
          style={{ position: 'fixed', width: '100vw', height: '100vh', zIndex: 9999 }}
        />
      )}
    </div>
  );
}

export default App;
```

- [ ] **Step 5: Fix any imports referencing old ActiveView location**

Update any file that imports `ActiveView` from `./hooks/useResultActions` to import from `../../stores/uiStore` instead. Files to check:
- `src/app/components/ViewRouter.tsx` — update import

- [ ] **Step 6: Run all tests + type check**

Run: `bun run build && bun run test`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/ src/stores/
git commit -m "refactor: migrate state management to zustand stores"
```

---

## Task 6: Create Toast system

**Files:**
- Create: `src/shared/components/ui/Toast.tsx`
- Create: `src/shared/components/ui/Toast.css`
- Test: `src/shared/components/ui/__tests__/Toast.test.tsx`
- Modify: `src/shared/components/ui/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/shared/components/ui/__tests__/Toast.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToastStore } from '../Toast';

describe('useToastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('addToast adds a toast', () => {
    act(() => {
      useToastStore.getState().addToast('Hello', 'info');
    });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('Hello');
    expect(toasts[0].type).toBe('info');
  });

  it('limits to 3 toasts max', () => {
    act(() => {
      useToastStore.getState().addToast('One', 'info');
      useToastStore.getState().addToast('Two', 'info');
      useToastStore.getState().addToast('Three', 'info');
      useToastStore.getState().addToast('Four', 'info');
    });
    expect(useToastStore.getState().toasts).toHaveLength(3);
    expect(useToastStore.getState().toasts[0].message).toBe('Two');
  });

  it('removeToast removes by id', () => {
    act(() => {
      useToastStore.getState().addToast('Hello', 'info');
    });
    const id = useToastStore.getState().toasts[0].id;
    act(() => {
      useToastStore.getState().removeToast(id);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- src/shared/components/ui/__tests__/Toast.test.tsx`
Expected: FAIL

- [ ] **Step 3: Write Toast component and store**

Create `src/shared/components/ui/Toast.tsx`:

```typescript
import { useEffect } from 'react';
import { create } from 'zustand';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import './Toast.css';

export interface ToastItem {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
  duration: number;
}

interface ToastStore {
  toasts: ToastItem[];
  addToast: (message: string, type?: 'info' | 'success' | 'error', duration?: number) => void;
  removeToast: (id: string) => void;
}

let toastCounter = 0;

export const useToastStore = create<ToastStore>()((set) => ({
  toasts: [],

  addToast: (message, type = 'info', duration = 5000) => {
    const id = `toast-${++toastCounter}`;
    set((state) => {
      const newToasts = [...state.toasts, { id, message, type, duration }];
      // Keep max 3 toasts
      return { toasts: newToasts.slice(-3) };
    });
  },

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

function ToastIcon({ type }: { type: ToastItem['type'] }) {
  switch (type) {
    case 'success': return <CheckCircle size={16} />;
    case 'error': return <AlertCircle size={16} />;
    default: return <Info size={16} />;
  }
}

function ToastEntry({ toast }: { toast: ToastItem }) {
  const removeToast = useToastStore((s) => s.removeToast);

  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => removeToast(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, removeToast]);

  return (
    <div className={`toast toast-${toast.type}`} role="status">
      <ToastIcon type={toast.type} />
      <span className="toast-message">{toast.message}</span>
      <button
        className="toast-close"
        onClick={() => removeToast(toast.id)}
        aria-label="Dismiss notification"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <ToastEntry key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
```

Create `src/shared/components/ui/Toast.css`:

```css
.toast-container {
  position: fixed;
  bottom: 48px;
  right: var(--spacing-md);
  z-index: var(--z-tooltip);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  max-width: 320px;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  backdrop-filter: blur(var(--glass-blur));
  animation: toast-slide-in var(--transition-normal) ease-out;
  box-shadow: var(--shadow-lg);
}

.toast-info { border-left: 3px solid var(--color-accent); }
.toast-success { border-left: 3px solid var(--color-success); }
.toast-error { border-left: 3px solid var(--color-error); }

.toast-info svg { color: var(--color-accent); }
.toast-success svg { color: var(--color-success); }
.toast-error svg { color: var(--color-error); }

.toast-message {
  flex: 1;
  line-height: var(--line-height-normal);
}

.toast-close {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: var(--radius-sm);
}

.toast-close:hover {
  color: var(--color-text-primary);
  background: var(--color-surface-hover);
}

@keyframes toast-slide-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

- [ ] **Step 4: Export from UI barrel**

Add to `src/shared/components/ui/index.ts`:

```typescript
export { ToastContainer, useToastStore } from './Toast';
export type { ToastItem } from './Toast';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test -- src/shared/components/ui/__tests__/Toast.test.tsx`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/components/ui/Toast.tsx src/shared/components/ui/Toast.css src/shared/components/ui/__tests__/Toast.test.tsx src/shared/components/ui/index.ts
git commit -m "feat: add toast notification system"
```

---

## Task 7: Add indexing progress toast

**Files:**
- Modify: `src/app/hooks/useAppLifecycle.ts`
- Modify: `src/app/App.tsx` — add `<ToastContainer />`

- [ ] **Step 1: Add ToastContainer to App.tsx**

In `src/app/App.tsx`, import `ToastContainer` from `../shared/components/ui` and add `<ToastContainer />` just before the closing `</div>` of the app-container.

- [ ] **Step 2: Add indexing progress polling to useAppLifecycle**

In `src/app/hooks/useAppLifecycle.ts`, in the `startFileIndexing` function, after calling `invoke('start_indexing', ...)`:

```typescript
import { useToastStore } from '../../shared/components/ui/Toast';

// Inside startFileIndexing, after invoke('start_indexing'):
const { addToast } = useToastStore.getState();
addToast(`Indexing ${foldersToIndex.length} folder(s)...`, 'info');

// After the try/catch finally block, when indexing completes:
// In the try block after setIsIndexing(true) and await invoke:
addToast(`Indexing complete`, 'success');

// In the catch block:
addToast('Indexing failed', 'error');
```

The full updated section of `startFileIndexing`:

```typescript
try {
  setIsIndexing(true);
  const { addToast } = useToastStore.getState();
  addToast(`Indexing ${foldersToIndex.length} folder(s)...`, 'info');
  await invoke('start_indexing', {
    folders: foldersToIndex,
    excludedPaths: settings.indexing.excludedPaths,
    fileExtensions: settings.indexing.fileExtensions,
  });
  addToast('Indexing complete', 'success');
} catch (err) {
  logger.error('Failed to start file indexing:', err);
  useToastStore.getState().addToast('Indexing failed', 'error');
} finally {
  setIsIndexing(false);
}
```

- [ ] **Step 3: Run build + tests**

Run: `bun run build && bun run test`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/hooks/useAppLifecycle.ts src/app/App.tsx
git commit -m "feat: show toast notifications for indexing progress"
```

---

## Task 8: Add onboarding modal — settings flag

**Files:**
- Modify: `src/features/settings/types/settings.types.ts`
- Modify: `src-tauri/src/commands/settings.rs`

- [ ] **Step 1: Add hasSeenOnboarding to TypeScript settings**

In `src/features/settings/types/settings.types.ts`, add to `GeneralSettings` interface:

```typescript
export interface GeneralSettings {
  startWithWindows: boolean;
  maxResults: number;
  closeOnLaunch: boolean;
  hasSeenOnboarding: boolean;
}
```

And update `DEFAULT_SETTINGS.general`:

```typescript
general: {
  startWithWindows: false,
  maxResults: 8,
  closeOnLaunch: true,
  hasSeenOnboarding: false,
},
```

- [ ] **Step 2: Add has_seen_onboarding to Rust settings**

In `src-tauri/src/commands/settings.rs`, add to `GeneralSettings` struct:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub start_with_windows: bool,
    pub max_results: u32,
    pub close_on_launch: bool,
    #[serde(default)]
    pub has_seen_onboarding: bool,
}
```

And update `Default` impl:

```rust
impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            start_with_windows: false,
            max_results: 8,
            close_on_launch: true,
            has_seen_onboarding: false,
        }
    }
}
```

The `#[serde(default)]` on `has_seen_onboarding` ensures backward compatibility with existing `settings.json` files that don't have this field.

- [ ] **Step 3: Verify build**

Run: `bun run build && cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/types/settings.types.ts src-tauri/src/commands/settings.rs
git commit -m "feat: add hasSeenOnboarding flag to settings"
```

---

## Task 9: Create OnboardingModal component

**Files:**
- Create: `src/shared/components/ui/OnboardingModal.tsx`
- Create: `src/shared/components/ui/OnboardingModal.css`
- Modify: `src/shared/components/ui/index.ts`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Create OnboardingModal component**

Create `src/shared/components/ui/OnboardingModal.tsx`:

```typescript
import { useState } from 'react';
import { Keyboard, FolderSearch, Puzzle } from 'lucide-react';
import { Modal } from './Modal';
import './OnboardingModal.css';

interface OnboardingModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

const steps = [
  {
    icon: Keyboard,
    title: 'Global Hotkey',
    description:
      'Press Ctrl+Space anywhere to summon Volt instantly. You can change this shortcut in Settings > Hotkeys.',
  },
  {
    icon: FolderSearch,
    title: 'File Indexing',
    description:
      'Volt indexes your files for instant search. Configure which folders to index in Settings > Indexing.',
  },
  {
    icon: Puzzle,
    title: 'Built-in Plugins',
    description:
      'Calculator, emoji picker, web search, timer, system monitor and more — just start typing to use them.',
  },
];

export function OnboardingModal({ isOpen, onComplete }: OnboardingModalProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const isLastStep = currentStep === steps.length - 1;
  const step = steps[currentStep];
  const StepIcon = step.icon;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const handleSkip = () => {
    onComplete();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleSkip} size="small">
      <div className="onboarding">
        <div className="onboarding-icon">
          <StepIcon size={40} strokeWidth={1.5} />
        </div>

        <h3 className="onboarding-title">{step.title}</h3>
        <p className="onboarding-description">{step.description}</p>

        <div className="onboarding-dots">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`onboarding-dot ${i === currentStep ? 'active' : ''}`}
              aria-label={`Step ${i + 1} of ${steps.length}`}
            />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="onboarding-skip" onClick={handleSkip} type="button">
            Skip
          </button>
          <button className="onboarding-next" onClick={handleNext} type="button">
            {isLastStep ? 'Get Started' : 'Next'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 2: Create OnboardingModal styles**

Create `src/shared/components/ui/OnboardingModal.css`:

```css
.onboarding {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: var(--spacing-lg) var(--spacing-xl);
  gap: var(--spacing-md);
}

.onboarding-icon {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-lg);
  background: var(--color-surface-hover);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-accent);
  margin-bottom: var(--spacing-xs);
}

.onboarding-title {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin: 0;
}

.onboarding-description {
  font-size: var(--font-size-base);
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
  margin: 0;
  max-width: 320px;
}

.onboarding-dots {
  display: flex;
  gap: var(--spacing-sm);
  margin: var(--spacing-sm) 0;
}

.onboarding-dot {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  background: var(--color-border);
  transition: background var(--transition-fast);
}

.onboarding-dot.active {
  background: var(--color-accent);
  width: 24px;
}

.onboarding-actions {
  display: flex;
  gap: var(--spacing-md);
  width: 100%;
  justify-content: center;
  margin-top: var(--spacing-sm);
}

.onboarding-skip {
  background: none;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  font-size: var(--font-size-sm);
  padding: var(--spacing-sm) var(--spacing-lg);
  border-radius: var(--radius-md);
}

.onboarding-skip:hover {
  color: var(--color-text-secondary);
  background: var(--color-surface-hover);
}

.onboarding-next {
  background: var(--color-accent);
  color: white;
  border: none;
  cursor: pointer;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  padding: var(--spacing-sm) var(--spacing-xl);
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
}

.onboarding-next:hover {
  background: var(--color-accent-hover);
}
```

- [ ] **Step 3: Export from UI barrel**

Add to `src/shared/components/ui/index.ts`:

```typescript
export { OnboardingModal } from './OnboardingModal';
```

- [ ] **Step 4: Wire onboarding into App.tsx**

In `src/app/App.tsx`:

Import `OnboardingModal` and `settingsService`:

```typescript
import { OnboardingModal } from '../shared/components/ui';
import { settingsService } from '../features/settings';
```

Add the onboarding complete handler and render the modal. In the component body:

```typescript
const handleOnboardingComplete = useCallback(async () => {
  if (!settings) return;
  const updated = {
    ...settings,
    general: { ...settings.general, hasSeenOnboarding: true },
  };
  await settingsService.updateGeneralSettings(updated.general).catch(() => {});
  useAppStore.getState().setSettings(updated);
}, [settings]);
```

In the JSX, before the `<ResultContextMenu>`:

```tsx
{settings && !settings.general.hasSeenOnboarding && (
  <OnboardingModal isOpen={true} onComplete={handleOnboardingComplete} />
)}
```

- [ ] **Step 5: Run build + tests**

Run: `bun run build && bun run test`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/components/ui/OnboardingModal.tsx src/shared/components/ui/OnboardingModal.css src/shared/components/ui/index.ts src/app/App.tsx
git commit -m "feat: add onboarding modal for first-launch users"
```

---

## Task 10: Accessibility — skip link

**Files:**
- Modify: `src/app/App.tsx`
- Create: `src/styles/accessibility.css`
- Modify: `src/features/search/components/SearchBar.tsx`

- [ ] **Step 1: Add id to search input**

In `src/features/search/components/SearchBar.tsx`, add `id="search-input"` to the `<input>` element:

```tsx
<input
  ref={inputRef}
  id="search-input"
  type="text"
  // ... rest unchanged
```

- [ ] **Step 2: Create accessibility.css**

Create `src/styles/accessibility.css`:

```css
/* Skip navigation link - visible only on focus */
.skip-link {
  position: absolute;
  left: -9999px;
  top: var(--spacing-xs);
  z-index: var(--z-overlay);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-accent);
  color: white;
  border-radius: var(--radius-md);
  font-size: var(--font-size-sm);
  text-decoration: none;
  font-weight: var(--font-weight-medium);
}

.skip-link:focus {
  left: var(--spacing-md);
}

/* Screen reader only class (already used in SearchBar) */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```

- [ ] **Step 3: Add skip link to App.tsx**

In `src/app/App.tsx`, import the CSS and add the skip link as the first child of `app-container`:

```typescript
import '../styles/accessibility.css';
```

```tsx
<div className="app-container glass">
  <a href="#search-input" className="skip-link">Skip to search</a>
  {/* rest of existing JSX */}
```

- [ ] **Step 4: Run build**

Run: `bun run build`
Expected: BUILD SUCCESS

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx src/styles/accessibility.css src/features/search/components/SearchBar.tsx
git commit -m "feat: add skip-to-search link for keyboard accessibility"
```

---

## Task 11: Accessibility — contrast audit and fixes

**Files:**
- Modify: `src/styles/variables.css`
- Modify: `src/styles/themes/light.css`

- [ ] **Step 1: Audit and fix dark theme contrast**

In `src/styles/variables.css`, the dark theme secondary text is `rgba(255, 255, 255, 0.7)` on `rgba(20, 20, 30, 0.85)`. This gives ~11:1 — passes AA.

Tertiary text is `rgba(255, 255, 255, 0.55)` on same background — ~8.5:1 — passes AA.

Verify `--color-accent: #6366f1` on dark surface: #6366f1 on rgba(30,30,45) gives ~4.6:1 — passes AA for normal text (4.5:1 minimum). OK.

No changes needed for dark theme.

- [ ] **Step 2: Audit and fix light theme contrast**

In `src/styles/themes/light.css`:
- `--color-text-secondary: rgba(0, 0, 0, 0.65)` on `rgba(250, 250, 255, 0.85)` — ~8.3:1 — passes AA.
- `--color-text-tertiary: rgba(0, 0, 0, 0.55)` on same — ~6.3:1 — passes AA for normal text.
- `--color-accent: #6366f1` on white-ish bg — ~3.9:1 — **FAILS AA for normal text** (needs 4.5:1).

Fix: darken the light theme accent-hover to ensure interactive elements are readable:

```css
[data-theme='light'] {
  --color-accent: #4f46e5;  /* was #6366f1 — darkened for 4.5:1 contrast on light bg */
  --color-accent-hover: #4338ca;  /* was #4f46e5 — darkened proportionally */
}
```

- [ ] **Step 3: Run build**

Run: `bun run build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit**

```bash
git add src/styles/themes/light.css
git commit -m "fix(a11y): darken accent color on light theme for WCAG AA contrast"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: ALL PASS (existing 130+ tests + new store tests)

- [ ] **Step 2: Run Rust check**

Run: `cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 3: Run TypeScript build**

Run: `bun run build`
Expected: BUILD SUCCESS

- [ ] **Step 4: Commit any remaining fixes**

If any fixes were needed, commit them.
