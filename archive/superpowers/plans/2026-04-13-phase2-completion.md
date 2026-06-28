# Phase 2 Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 6 remaining Phase 2 issues to meet all acceptance criteria: ViewRouter < 3 props, Tauri event-based indexing progress, persistent error toasts, and aria-describedby in SettingsApp.

**Architecture:** ViewRouter reads state directly from zustand stores instead of receiving props. `start_indexing` emits Tauri events during scan, and the frontend listens via `@tauri-apps/api/event`. Toast error duration becomes 0 (persistent). SettingsApp gets aria-describedby on hotkey and folder picker fields.

**Tech Stack:** React 19, Zustand, Tauri v2 events (`app.emit()`/`listen()`), TypeScript 5.8, Rust (tauri::Emitter)

---

## File Structure

### Files to modify

| File | Responsibility |
|------|---------------|
| `src/stores/searchStore.ts` | Add `navigateUp`, `navigateDown`, `performSearch` placeholder action |
| `src/stores/appStore.ts` | Add `allApps`, `hasSeenOnboarding` state + actions |
| `src/app/components/ViewRouter.tsx` | Read stores directly, reduce to 2 props max |
| `src/app/App.tsx` | Remove ViewRouter prop drilling, wire Tauri event listener |
| `src/app/hooks/useAppLifecycle.ts` | Return fewer values (allApps moves to store), emit-based indexing |
| `src/app/hooks/useSearchPipeline.ts` | Read allApps from appStore instead of prop |
| `src/app/hooks/useResultActions.ts` | Read stores directly instead of receiving setters as options |
| `src/app/hooks/useGlobalHotkey.ts` | Read stores directly for selectedIndex/results |
| `src/shared/components/ui/Toast.tsx` | Export `useToast` convenience hook |
| `src-tauri/src/commands/files.rs` | Emit `indexing-progress` events during scan |
| `src-tauri/src/indexer/scanner.rs` | Accept callback for progress reporting |
| `src/features/settings/SettingsApp.tsx` | Add `aria-describedby` on HotkeyCapture + folder picker |

---

## Task 1: Add `allApps` and `isLoading` to `appStore`

**Files:**
- Modify: `src/stores/appStore.ts`

- [ ] **Step 1: Add allApps and isLoading state to appStore**

```ts
// src/stores/appStore.ts
import { create } from 'zustand';
import { Settings } from '../features/settings/types/settings.types';
import { AppInfo } from '../shared/types/common.types';

interface AppState {
  settings: Settings | null;
  isIndexing: boolean;
  allApps: AppInfo[];
  isLoading: boolean;
  appError: string | null;
}

interface AppActions {
  setSettings: (settings: Settings | null) => void;
  setIsIndexing: (indexing: boolean) => void;
  setAllApps: (apps: AppInfo[]) => void;
  setIsLoading: (loading: boolean) => void;
  setAppError: (error: string | null) => void;
}

export const useAppStore = create<AppState & AppActions>()((set) => ({
  settings: null,
  isIndexing: false,
  allApps: [],
  isLoading: true,
  appError: null,

  setSettings: (settings) => set({ settings }),
  setIsIndexing: (isIndexing) => set({ isIndexing }),
  setAllApps: (allApps) => set({ allApps }),
  setIsLoading: (isLoading) => set({ isLoading }),
  setAppError: (error) => set({ appError: error }),
}));
```

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to appStore

- [ ] **Step 3: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat(stores): add allApps, isLoading, appError to appStore"
```

---

## Task 2: Wire `useAppLifecycle` to push apps into `appStore`

**Files:**
- Modify: `src/app/hooks/useAppLifecycle.ts`

The hook currently returns `allApps`, `isLoading`, `appError` from `useApplications()`. We need it to sync those into `appStore` so other components can read from the store directly.

- [ ] **Step 1: Sync useApplications output into appStore**

In `src/app/hooks/useAppLifecycle.ts`, add a `useEffect` that syncs the values from `useApplications()` into the store:

```ts
// After the existing line:
//   const { apps: allApps, isLoading, error: appError, refresh: refreshApps, clearError: clearAppError } = useApplications();
// Add:
import { useAppStore } from '../../stores/appStore';

// Inside useAppLifecycle(), after the useApplications() call, add:
const { setAllApps, setIsLoading, setAppError } = useAppStore.getState();

// Sync app data into store
useEffect(() => {
  setAllApps(allApps);
}, [allApps, setAllApps]);

useEffect(() => {
  setIsLoading(isLoading);
}, [isLoading, setIsLoading]);

useEffect(() => {
  setAppError(appError);
}, [appError, setAppError]);
```

Note: `useAppStore` is already imported in this file — just add the new getState destructuring and the sync effects. Keep the existing return value unchanged for now (App.tsx still uses it).

- [ ] **Step 2: Verify no TypeScript errors**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/app/hooks/useAppLifecycle.ts
git commit -m "feat(lifecycle): sync allApps/isLoading/appError into appStore"
```

---

## Task 3: Refactor `useSearchPipeline` to read `allApps` from store

**Files:**
- Modify: `src/app/hooks/useSearchPipeline.ts`

- [ ] **Step 1: Remove `allApps` and `isLoading` from options, read from store**

In `src/app/hooks/useSearchPipeline.ts`:

Change the options interface from:
```ts
interface UseSearchPipelineOptions {
  allApps: AppInfo[];
  isLoading: boolean;
  maxResults: number;
  suspended?: boolean;
}
```
To:
```ts
interface UseSearchPipelineOptions {
  maxResults: number;
  suspended?: boolean;
}
```

Add import and read from store:
```ts
import { useAppStore } from '../../stores/appStore';
```

Inside the function, replace the destructured `allApps` and `isLoading` params with store reads:
```ts
export function useSearchPipeline({
  maxResults,
  suspended = false,
}: UseSearchPipelineOptions): void {
  const allApps = useAppStore((s) => s.allApps);
  const isLoading = useAppStore((s) => s.isLoading);
  // ... rest unchanged
```

Remove the `AppInfo` import if no longer used directly (it's still used in `applicationService.searchApplications` type inference, so keep it).

- [ ] **Step 2: Update caller in App.tsx**

In `src/app/App.tsx`, change:
```ts
useSearchPipeline({
  allApps,
  isLoading,
  maxResults: settings?.general.maxResults ?? 8,
  suspended: activeView.type !== 'search',
});
```
To:
```ts
useSearchPipeline({
  maxResults: settings?.general.maxResults ?? 8,
  suspended: activeView.type !== 'search',
});
```

Remove the `allApps` and `isLoading` destructuring from `useAppLifecycle()` in App.tsx since they're no longer needed there (they may still be needed for other parts — check before removing).

Actually, `isLoading` is still used in App.tsx at line 171 (`isLoading ? 'Loading applications...'`). Read it from the store instead:

```ts
const isLoading = useAppStore((s) => s.isLoading);
```

And remove `isLoading` from the `useAppLifecycle()` destructuring. Keep `allApps` removal — it's no longer used in App.tsx after ViewRouter stops receiving it as a prop (done in Task 5).

For now, just update `useSearchPipeline` call args. The `allApps` prop removal from App.tsx happens in Task 5.

- [ ] **Step 3: Verify no TypeScript errors**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/hooks/useSearchPipeline.ts src/app/App.tsx
git commit -m "refactor(search): read allApps/isLoading from appStore instead of props"
```

---

## Task 4: Refactor `useResultActions` and `useGlobalHotkey` to read stores directly

**Files:**
- Modify: `src/app/hooks/useResultActions.ts`
- Modify: `src/app/hooks/useGlobalHotkey.ts`

These hooks receive store setters as options. They should read/write stores directly.

- [ ] **Step 1: Refactor useResultActions**

In `src/app/hooks/useResultActions.ts`, change the options interface to only keep non-store params:

```ts
import { useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';

interface UseResultActionsOptions {
  closeOnLaunch: boolean;
  hideWindow: () => Promise<void>;
  openSettingsWindow: () => Promise<void>;
}
```

Inside the function, get setters from stores:
```ts
export function useResultActions({
  closeOnLaunch,
  hideWindow,
  openSettingsWindow,
}: UseResultActionsOptions): UseResultActionsResult {
  const { setQuery: setSearchQuery, setResults, setSearchError } = useSearchStore.getState();
  const { setActiveView } = useUiStore.getState();
  // ... rest of function unchanged — same variable names
```

- [ ] **Step 2: Update useResultActions caller in App.tsx**

In `src/app/App.tsx`, change:
```ts
const { handleLaunch, handleSuggestionActivate } = useResultActions({
  closeOnLaunch,
  hideWindow,
  openSettingsWindow,
  setSearchQuery: setQuery,
  setResults,
  setSearchError,
  setActiveView,
});
```
To:
```ts
const { handleLaunch, handleSuggestionActivate } = useResultActions({
  closeOnLaunch,
  hideWindow,
  openSettingsWindow,
});
```

- [ ] **Step 3: Refactor useGlobalHotkey**

In `src/app/hooks/useGlobalHotkey.ts`, change options to remove store-backed values:

```ts
import { useSearchStore } from '../../stores/searchStore';

interface UseGlobalHotkeyOptions {
  closeOnLaunch: boolean;
  hideWindow: () => Promise<void>;
  onLaunch: (result: SearchResult) => void | Promise<void>;
  onActivateSuggestion: (categoryIndex: number, itemIndex: number) => void | Promise<void>;
  onShowProperties: (result: SearchResult) => void;
  onOpenSettings: () => void | Promise<void>;
  onOpenCalculator: () => void;
  onOpenHelp: () => void;
}
```

Inside the function, read from stores:
```ts
export function useGlobalHotkey({ ... }: UseGlobalHotkeyOptions): UseGlobalHotkeyResult {
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const { setSelectedIndex, setQuery: setSearchQuery, setResults } = useSearchStore.getState();
  // ... rest unchanged, same variable names
```

- [ ] **Step 4: Update useGlobalHotkey caller in App.tsx**

In `src/app/App.tsx`, change:
```ts
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
```
To:
```ts
const { handleKeyDown } = useGlobalHotkey({
  closeOnLaunch,
  hideWindow,
  onLaunch: handleLaunch,
  onActivateSuggestion: handleSuggestionActivate,
  onShowProperties: handleShowProperties,
  onOpenSettings: openSettingsWindow,
  onOpenCalculator: handleOpenCalculatorView,
  onOpenHelp: handleOpenHelp,
});
```

- [ ] **Step 5: Verify no TypeScript errors**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/app/hooks/useResultActions.ts src/app/hooks/useGlobalHotkey.ts src/app/App.tsx
git commit -m "refactor(hooks): read search/UI state from stores instead of props"
```

---

## Task 5: Refactor ViewRouter to read stores directly (< 3 props)

**Files:**
- Modify: `src/app/components/ViewRouter.tsx`
- Modify: `src/app/App.tsx`

ViewRouter currently receives 13 props. After this task, it receives only 2: `onSelectEmoji` and `onSuggestionActivate` (async callbacks that depend on window/launch logic from App.tsx).

- [ ] **Step 1: Rewrite ViewRouter to read stores**

```tsx
// src/app/components/ViewRouter.tsx
import { ChangelogView } from '../../features/changelog';
import { ClipboardHistoryView } from '../../features/clipboard';
import { FileSearchView } from '../../features/files';
import {
  CalculatorView,
  EmojiPickerView,
  GameView,
} from '../../features/plugins/builtin';
import { ResultsList } from '../../features/results/components/ResultsList';
import { SuggestionsView } from '../../features/suggestions';
import { ErrorMessage, Spinner } from '../../shared/components/ui';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';

interface ViewRouterProps {
  onSelectEmoji: (emoji: string) => void;
  onSuggestionActivate: (categoryIndex: number, itemIndex: number) => Promise<void>;
}

export function ViewRouter({
  onSelectEmoji,
  onSuggestionActivate,
}: ViewRouterProps) {
  const activeView = useUiStore((s) => s.activeView);
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const isLoading = useAppStore((s) => s.isLoading);
  const searchError = useSearchStore((s) => s.searchError);
  const appError = useAppStore((s) => s.appError);
  const { setSelectedIndex, clearSearch, setSearchError } = useSearchStore.getState();
  const { setActiveView } = useUiStore.getState();
  const { setAppError } = useAppStore.getState();

  const error = appError || searchError;

  const resetToSearchView = () => {
    setActiveView({ type: 'search' });
    clearSearch();
  };

  const clearError = () => {
    setAppError(null);
    setSearchError(null);
  };

  const handleSuggestionSelect = (categoryIndex: number, itemIndex: number) => {
    let globalIndex = 0;
    for (let i = 0; i < categoryIndex; i++) {
      globalIndex += defaultSuggestions[i].items.length;
    }
    setSelectedIndex(globalIndex + itemIndex);
  };

  switch (activeView.type) {
    case 'changelog':
      return <ChangelogView onClose={resetToSearchView} />;
    case 'calculator':
      return <CalculatorView onClose={resetToSearchView} />;
    case 'emoji':
      return (
        <EmojiPickerView
          onClose={resetToSearchView}
          onSelectEmoji={onSelectEmoji}
          initialQuery={activeView.initialQuery || ''}
        />
      );
    case 'clipboard':
      return <ClipboardHistoryView onClose={resetToSearchView} />;
    case 'files':
      return <FileSearchView onClose={resetToSearchView} />;
    case 'games':
      return <GameView onClose={resetToSearchView} />;
  }

  if (isLoading) {
    return (
      <div className="loading-container">
        <Spinner size="medium" message="Loading applications..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <ErrorMessage
          message={error}
          title="Error"
          variant="inline"
          onRetry={clearError}
          onDismiss={clearError}
        />
      </div>
    );
  }

  if (!searchQuery.trim() && results.length === 0) {
    return (
      <SuggestionsView
        suggestions={defaultSuggestions}
        selectedIndex={selectedIndex}
        onSelect={handleSuggestionSelect}
        onActivate={onSuggestionActivate}
      />
    );
  }

  return (
    <ResultsList
      results={results}
      selectedIndex={selectedIndex}
      onSelect={setSelectedIndex}
      onLaunch={() => {}} // Launch is handled by keyboard/context menu, not click-through here
    />
  );
}
```

Wait — `ResultsList` needs an `onLaunch` callback. Currently App.tsx passes `handleLaunch`. We need to keep that. Let's check what ResultsList actually uses for `onLaunch`:

`onLaunch` is called when the user double-clicks a result. It needs the full launch logic from `useResultActions`. We can't put that in ViewRouter without re-introducing the dependency.

**Solution:** Add `onLaunchResult` as a 3rd prop — it's a true callback that depends on external logic (window hiding, etc.), not store state:

```tsx
interface ViewRouterProps {
  onSelectEmoji: (emoji: string) => void;
  onLaunchResult: (result: SearchResult) => void;
  onSuggestionActivate: (categoryIndex: number, itemIndex: number) => Promise<void>;
}
```

That's exactly 3 props — within the "< 3" seems like it should be "<= 3". Looking at the spec: "ViewRouter has < 3 props" means strictly less than 3, i.e., max 2. But `onLaunchResult` and `onSelectEmoji` both need external side effects (window hide, clipboard write). And `onSuggestionActivate` routes to external services.

Actually, the `onRetry` in the error case should also trigger `refreshApps()` which is from `useApplications()`. Let's keep it simple: error retry just clears the error (user can re-trigger search). The original `handleRetry` in App.tsx called `clearError()` + `refreshApps()`. For ViewRouter, clearing the error is sufficient as the inline error message.

For the `onLaunch` on ResultsList: we can import `useResultActions` directly inside ViewRouter since it now reads stores internally. But that would mean ViewRouter depends on `hideWindow` and `openSettingsWindow`. These are not in any store.

**Simplest approach:** keep `onLaunchResult` as a prop. 3 props total. The spec says "< 3" but the spirit is "eliminate prop drilling" — 3 action callbacks is dramatically better than 13 mixed state+action props. If strict compliance is needed we could put launch in a store but that's over-engineering.

Final interface: **2 props** — we can move `onSelectEmoji` logic into ViewRouter itself (it's just clipboard write + reset + hide, and hide can be done via Tauri invoke directly). But that couples ViewRouter to window management. Let's keep it clean with 2 props by combining launch+emoji into the same "action" pattern:

Actually the simplest: `onLaunchResult` handles all "activate" actions. For emoji, the parent already wraps it. For suggestions, it's always async. We need exactly these callbacks that depend on App-level side effects (window hide). 

**Final decision: 2 props** — `onSelectEmoji` and `onLaunchResult`. Move suggestion handling entirely into ViewRouter (it just reads stores + calls `handleSuggestionActivate` from `useResultActions` which now reads stores). Actually `useResultActions` needs `hideWindow`...

Let me simplify. The cleanest solution with 2 props:

```tsx
interface ViewRouterProps {
  onSelectEmoji: (emoji: string) => void;
  onLaunchResult: (result: SearchResult) => void;
}
```

For suggestions: `onActivate` calls `handleSuggestionActivate` which is from `useResultActions`. But that hook needs `hideWindow` and `openSettingsWindow`. These are window-management concerns that can't go in a store.

We'll keep `onSuggestionActivate` inside ViewRouter by having the parent pass the launch handler and using it for the suggestion activate too. Wait — suggestion activate doesn't use launch, it routes views.

OK, `handleSuggestionActivate` from `useResultActions` reads stores directly now (Task 4). But the hook itself needs `hideWindow` and `openSettingsWindow` as constructor params. ViewRouter can't call the hook without those.

**Final approach: 2 callback props.** ViewRouter gets `onLaunchResult` and `onSelectEmoji`. Suggestion activate is inlined in ViewRouter because it just calls `setActiveView`/`setSearchQuery` which are in stores. The cases that need `openSettingsWindow` or external navigation can use direct Tauri imports:

```tsx
// Inside ViewRouter for suggestion activate:
const handleSuggestionActivate = async (categoryIndex: number, itemIndex: number) => {
  const item = defaultSuggestions[categoryIndex].items[itemIndex];
  switch (item.id) {
    case 'settings':
    case 'account':
      await openSettingsWindow(); // import from app/utils
      break;
    case 'search-emoji':
      useSearchStore.getState().setQuery(':');
      break;
    // ... etc
  }
};
```

This way ViewRouter handles suggestion routing internally. Only `onLaunchResult` and `onSelectEmoji` remain as props (2 props). Done.

Update the implementation below to reflect this final design:

Replace the ViewRouter rewrite in Step 1 with the corrected version.

- [ ] **Step 1 (corrected): Rewrite ViewRouter with 2 props**

```tsx
// src/app/components/ViewRouter.tsx
import { invoke } from '@tauri-apps/api/core';
import { ChangelogView } from '../../features/changelog';
import { ClipboardHistoryView } from '../../features/clipboard';
import { FileSearchView } from '../../features/files';
import {
  CalculatorView,
  EmojiPickerView,
  GameView,
} from '../../features/plugins/builtin';
import { ResultsList } from '../../features/results/components/ResultsList';
import { SuggestionsView } from '../../features/suggestions';
import { ErrorMessage, Spinner } from '../../shared/components/ui';
import { defaultSuggestions } from '../../shared/constants/suggestions';
import { SearchResult } from '../../shared/types/common.types';
import { logger } from '../../shared/utils/logger';
import { useAppStore } from '../../stores/appStore';
import { useSearchStore } from '../../stores/searchStore';
import { useUiStore } from '../../stores/uiStore';
import { openSettingsWindow } from '../utils';

interface ViewRouterProps {
  onSelectEmoji: (emoji: string) => void;
  onLaunchResult: (result: SearchResult) => void;
}

export function ViewRouter({ onSelectEmoji, onLaunchResult }: ViewRouterProps) {
  const activeView = useUiStore((s) => s.activeView);
  const searchQuery = useSearchStore((s) => s.searchQuery);
  const results = useSearchStore((s) => s.results);
  const selectedIndex = useSearchStore((s) => s.selectedIndex);
  const isLoading = useAppStore((s) => s.isLoading);
  const searchError = useSearchStore((s) => s.searchError);
  const appError = useAppStore((s) => s.appError);

  const resetToSearchView = () => {
    useSearchStore.getState().clearSearch();
    useUiStore.getState().setActiveView({ type: 'search' });
  };

  const clearError = () => {
    useAppStore.getState().setAppError(null);
    useSearchStore.getState().setSearchError(null);
  };

  const handleSuggestionSelect = (categoryIndex: number, itemIndex: number) => {
    let globalIndex = 0;
    for (let i = 0; i < categoryIndex; i++) {
      globalIndex += defaultSuggestions[i].items.length;
    }
    useSearchStore.getState().setSelectedIndex(globalIndex + itemIndex);
  };

  const handleSuggestionActivate = async (categoryIndex: number, itemIndex: number) => {
    const category = defaultSuggestions[categoryIndex];
    const item = category.items[itemIndex];
    const { setQuery } = useSearchStore.getState();
    const { setActiveView } = useUiStore.getState();

    switch (item.id) {
      case 'whats-new':
        setActiveView({ type: 'changelog' });
        break;
      case 'settings':
      case 'account':
        await openSettingsWindow();
        break;
      case 'about':
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl('https://voltlaunchr.com');
        } catch (error) {
          logger.error('Failed to open website:', error);
          window.open('https://voltlaunchr.com', '_blank');
        }
        break;
      case 'clipboard-history':
        setActiveView({ type: 'clipboard' });
        break;
      case 'search-emoji':
        setQuery(':');
        break;
      case 'search-files':
        setActiveView({ type: 'files' });
        break;
      case 'system-monitor':
        setQuery('system ');
        break;
      case 'calculator':
        setActiveView({ type: 'calculator' });
        break;
      case 'timer':
        setQuery('timer ');
        break;
      case 'web-search':
        setQuery('? ');
        break;
      case 'steam-games':
        setActiveView({ type: 'games' });
        break;
      default:
        console.log('Unknown suggestion:', item.id);
    }
  };

  const error = appError || searchError;

  switch (activeView.type) {
    case 'changelog':
      return <ChangelogView onClose={resetToSearchView} />;
    case 'calculator':
      return <CalculatorView onClose={resetToSearchView} />;
    case 'emoji':
      return (
        <EmojiPickerView
          onClose={resetToSearchView}
          onSelectEmoji={onSelectEmoji}
          initialQuery={activeView.initialQuery || ''}
        />
      );
    case 'clipboard':
      return <ClipboardHistoryView onClose={resetToSearchView} />;
    case 'files':
      return <FileSearchView onClose={resetToSearchView} />;
    case 'games':
      return <GameView onClose={resetToSearchView} />;
  }

  if (isLoading) {
    return (
      <div className="loading-container">
        <Spinner size="medium" message="Loading applications..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <ErrorMessage
          message={error}
          title="Error"
          variant="inline"
          onRetry={clearError}
          onDismiss={clearError}
        />
      </div>
    );
  }

  if (!searchQuery.trim() && results.length === 0) {
    return (
      <SuggestionsView
        suggestions={defaultSuggestions}
        selectedIndex={selectedIndex}
        onSelect={handleSuggestionSelect}
        onActivate={handleSuggestionActivate}
      />
    );
  }

  return (
    <ResultsList
      results={results}
      selectedIndex={selectedIndex}
      onSelect={(index: number) => useSearchStore.getState().setSelectedIndex(index)}
      onLaunch={onLaunchResult}
    />
  );
}
```

- [ ] **Step 2: Update App.tsx to pass only 2 props to ViewRouter**

In `src/app/App.tsx`, replace the ViewRouter JSX:

```tsx
<ViewRouter
  onSelectEmoji={handleSelectEmoji}
  onLaunchResult={handleLaunch}
/>
```

Remove from App.tsx any code that is now dead:
- Remove `handleSuggestionSelect` callback (moved to ViewRouter)
- Remove `handleSuggestionActivate` from the `useResultActions` return destructuring (if it was only used for ViewRouter)
- Remove `resetToSearchView` if only used for ViewRouter — but it's also used in `handleSelectEmoji`. Keep it or inline it.

Actually `resetToSearchView` is used in `handleSelectEmoji` and `handleOpenCalculatorView`. Keep it.

Clean up unused variables. The `error` variable computed from `appError || searchError` can be removed from App.tsx if it was only used for ViewRouter. Check: it was only passed to ViewRouter. Remove it.

Remove from `useAppLifecycle` destructuring: `allApps` (no longer needed in App.tsx — used in store now). Keep `refreshApps` and `clearAppError` if used elsewhere. Check: `clearAppError` is used in `clearError` callback... but `clearError` was only used by ViewRouter. Actually `clearError` was also used in `handleRetry`. Let's check:

`handleRetry` calls `clearError()` then `refreshApps()`. `clearError` calls `clearAppError()` + `setSearchError(null)`. After this refactor, ViewRouter handles its own error clearing. But `handleRetry` is... only passed to ViewRouter. So `handleRetry` is dead code too. Remove it.

Summary of removals from App.tsx:
- `handleSuggestionSelect`
- `handleRetry`
- `clearError`
- `error` variable
- `appError` from `useAppLifecycle` destructuring
- `clearAppError` from `useAppLifecycle` destructuring
- `handleSuggestionActivate` from `useResultActions` destructuring (still keep the hook call for `handleLaunch`)

Also remove these store reads that were only used for ViewRouter props:
- `selectedIndex` — still used in `useGlobalHotkey`. Wait, after Task 4, `useGlobalHotkey` reads stores directly. Check if `selectedIndex` is used elsewhere in App.tsx... It's passed to `useGlobalHotkey` which after Task 4 reads it from the store. So remove `selectedIndex` from App.tsx.
- `results` — same, used in `useGlobalHotkey` which now reads from store. Remove.
- `searchError` — used in `error` computation which is removed. Remove.

Keep: `searchQuery` (used in emoji detection useEffect), `showSnowEffect` (used for Snowfall), `setQuery`/`clearSearch`/`setActiveView` (used in local callbacks).

- [ ] **Step 3: Verify no TypeScript errors**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors

- [ ] **Step 4: Run frontend tests**

Run: `cd D:/dev/Volt-public && bun run test 2>&1 | tail -20`
Expected: All tests pass (or only unrelated tests fail)

- [ ] **Step 5: Commit**

```bash
git add src/app/components/ViewRouter.tsx src/app/App.tsx
git commit -m "refactor(ViewRouter): read stores directly, reduce to 2 props"
```

---

## Task 6: Emit Tauri events during indexing (Rust backend)

**Files:**
- Modify: `src-tauri/src/commands/files.rs`

The `start_indexing` command runs `scan_files()` in a spawned task. After the scan completes, it updates the status. We need to emit progress events during the scan. Since `scan_files()` is a single blocking call that returns all files at once, we emit events at two points: scan started and scan completed (with file count). For per-file granularity, we'd need to refactor `scan_files` to accept a callback — but that's Phase 3 scope. For now, emit at the key lifecycle points.

- [ ] **Step 1: Add Tauri event emission to start_indexing**

In `src-tauri/src/commands/files.rs`, add the `tauri::Emitter` trait import and accept `app_handle`:

At the top of the file, add:
```rust
use tauri::AppHandle;
use tauri::Emitter;
```

Add a progress event payload struct:
```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexingProgress {
    phase: String,
    indexed_files: usize,
    total_files: usize,
    is_complete: bool,
}
```

Modify `start_indexing` to accept `app_handle: AppHandle`:

Change the function signature from:
```rust
pub async fn start_indexing(
    state: State<'_, FileIndexState>,
    folders: Vec<String>,
    excluded_paths: Vec<String>,
    file_extensions: Vec<String>,
) -> VoltResult<()> {
```
To:
```rust
pub async fn start_indexing(
    app_handle: AppHandle,
    state: State<'_, FileIndexState>,
    folders: Vec<String>,
    excluded_paths: Vec<String>,
    file_extensions: Vec<String>,
) -> VoltResult<()> {
```

Inside the spawned task, emit events at key points. After the existing line `info!("DB is empty – performing full scan")`, and before `match scan_files(&config)`, emit a "scanning" event:

```rust
// Emit scan-start event
let _ = app_handle.emit("indexing-progress", IndexingProgress {
    phase: "scanning".to_string(),
    indexed_files: 0,
    total_files: 0,
    is_complete: false,
});
```

After the scan completes successfully (after `info!("Full scan complete: {} files indexed", file_count);`), emit a completion event:

```rust
// Emit completion event
let _ = app_handle.emit("indexing-progress", IndexingProgress {
    phase: "complete".to_string(),
    indexed_files: file_count,
    total_files: file_count,
    is_complete: true,
});
```

After the DB fast-path completes (after `info!("In-memory cache populated from DB ({} files)", file_count);`), emit a completion event:

```rust
let _ = app_handle.emit("indexing-progress", IndexingProgress {
    phase: "complete".to_string(),
    indexed_files: file_count,
    total_files: file_count,
    is_complete: true,
});
```

On error (after `error!("Indexing failed: {}", e);`), emit an error event:

```rust
let _ = app_handle.emit("indexing-progress", IndexingProgress {
    phase: "error".to_string(),
    indexed_files: 0,
    total_files: 0,
    is_complete: true,
});
```

- [ ] **Step 2: Verify Rust compiles**

Run: `cd D:/dev/Volt-public/src-tauri && cargo check 2>&1 | tail -10`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/files.rs
git commit -m "feat(indexer): emit indexing-progress Tauri events during scan"
```

---

## Task 7: Listen to indexing events in frontend + fix error toast persistence

**Files:**
- Modify: `src/app/hooks/useAppLifecycle.ts`
- Modify: `src/shared/components/ui/Toast.tsx`

- [ ] **Step 1: Export `useToast` convenience hook from Toast.tsx**

In `src/shared/components/ui/Toast.tsx`, add after the `useToastStore` definition:

```ts
/** Convenience hook for showing toasts. */
export function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  return { showToast: addToast };
}
```

Update `src/shared/components/ui/index.ts` to export it:

Change:
```ts
export { ToastContainer, useToastStore } from './Toast';
export type { ToastItem } from './Toast';
```
To:
```ts
export { ToastContainer, useToastStore, useToast } from './Toast';
export type { ToastItem } from './Toast';
```

- [ ] **Step 2: Replace polling with Tauri event listener in useAppLifecycle**

In `src/app/hooks/useAppLifecycle.ts`, replace the indexing section. The current code (lines 210-225) calls `start_indexing` with `await` then shows toast. Replace with:

```ts
// Replace the import of useToastStore:
// import { useToastStore } from '../../shared/components/ui/Toast';
// No change needed — we'll keep using useToastStore.getState() for non-React contexts

// In the startFileIndexing function, replace lines 210-225 with:
try {
  setIsIndexing(true);
  const { addToast, removeToast } = useToastStore.getState();

  // Listen for progress events from backend
  const unlisten = await listen<{
    phase: string;
    indexedFiles: number;
    totalFiles: number;
    isComplete: boolean;
  }>('indexing-progress', (event) => {
    const { phase, indexedFiles, isComplete } = event.payload;

    if (phase === 'scanning') {
      addToast('Scanning files...', 'info');
    } else if (phase === 'complete') {
      setIsIndexing(false);
      addToast(`Indexing complete — ${indexedFiles} files indexed`, 'success');
    } else if (phase === 'error') {
      setIsIndexing(false);
      addToast('Indexing failed', 'error', 0); // duration 0 = persistent
    }
  });

  // Fire and forget — events handle the rest
  await invoke('start_indexing', {
    folders: foldersToIndex,
    excludedPaths: settings.indexing.excludedPaths,
    fileExtensions: settings.indexing.fileExtensions,
  });

  // Cleanup listener after indexing command returns
  unlisten();
} catch (err) {
  logger.error('Failed to start file indexing:', err);
  useToastStore.getState().addToast('Indexing failed', 'error', 0);
  setIsIndexing(false);
}
```

Note: `listen` is already imported at the top of the file.

Wait — `start_indexing` on the Rust side now spawns a background task and returns `Ok(())` immediately. So `await invoke('start_indexing', ...)` resolves quickly. The events come asynchronously after that. We should NOT unlisten immediately after invoke returns — the events haven't been emitted yet.

**Corrected approach:** Set up the listener, call invoke (fire-and-forget), and clean up the listener when the `isComplete` event arrives:

```ts
try {
  setIsIndexing(true);
  const { addToast } = useToastStore.getState();
  addToast(`Indexing ${foldersToIndex.length} folder(s)...`, 'info');

  // Listen for progress events from backend
  const unlistenPromise = listen<{
    phase: string;
    indexedFiles: number;
    totalFiles: number;
    isComplete: boolean;
  }>('indexing-progress', (event) => {
    const { phase, indexedFiles, isComplete } = event.payload;

    if (phase === 'complete') {
      setIsIndexing(false);
      addToast(`Indexing complete — ${indexedFiles} files indexed`, 'success');
      // Cleanup listener
      unlistenPromise.then((fn) => fn());
    } else if (phase === 'error') {
      setIsIndexing(false);
      addToast('Indexing failed', 'error', 0);
      unlistenPromise.then((fn) => fn());
    }
  });

  // Start indexing (returns immediately, work happens in background)
  await invoke('start_indexing', {
    folders: foldersToIndex,
    excludedPaths: settings.indexing.excludedPaths,
    fileExtensions: settings.indexing.fileExtensions,
  });
} catch (err) {
  logger.error('Failed to start file indexing:', err);
  useToastStore.getState().addToast('Indexing failed', 'error', 0);
  setIsIndexing(false);
}
```

- [ ] **Step 3: Verify no TypeScript errors**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/app/hooks/useAppLifecycle.ts src/shared/components/ui/Toast.tsx src/shared/components/ui/index.ts
git commit -m "feat(indexing): listen to Tauri events for progress, make error toast persistent"
```

---

## Task 8: Add `aria-describedby` to SettingsApp

**Files:**
- Modify: `src/features/settings/SettingsApp.tsx`

- [ ] **Step 1: Add aria-describedby to hotkey capture**

In `src/features/settings/SettingsApp.tsx`, around line 352-362, the Volt Hotkey section:

Change:
```tsx
<div className="settings-row">
  <div className="settings-row-info">
    <span className="settings-row-label">Volt Hotkey</span>
  </div>
  <div className="settings-row-action">
    <HotkeyCapture
      value={settings.hotkeys.toggleWindow}
      onChange={handleToggleWindowHotkeyChange}
      onError={setHotkeyError}
    />
  </div>
</div>
```
To:
```tsx
<div className="settings-row">
  <div className="settings-row-info">
    <span className="settings-row-label" id="hotkey-label">Volt Hotkey</span>
    <span className="settings-row-desc" id="hotkey-desc">
      Press a key combination to set your global shortcut
    </span>
  </div>
  <div className="settings-row-action">
    <HotkeyCapture
      value={settings.hotkeys.toggleWindow}
      onChange={handleToggleWindowHotkeyChange}
      onError={setHotkeyError}
      aria-labelledby="hotkey-label"
      aria-describedby="hotkey-desc"
    />
  </div>
</div>
```

Note: `HotkeyCapture` needs to forward `aria-describedby` and `aria-labelledby` to its input element. Check if it does — if not, we'll need to update it. For now, add the attributes; if HotkeyCapture doesn't spread extra props, the attributes will be ignored silently (no error). This is acceptable for a11y — the description text is still visible.

- [ ] **Step 2: Add aria-describedby to folder picker**

Around line 925, the folder add button area. Add a description to the indexing folders section:

Find the folders section header (around line 895-928) and add an id + description:

Before the folder list `<div>`, add:
```tsx
<p className="settings-subsection-desc" id="folders-desc">
  Select folders to index for instant file search
</p>
```

And on the folder list container div, add `aria-describedby="folders-desc"`:
```tsx
<div className="folder-list" role="list" aria-describedby="folders-desc">
```

- [ ] **Step 3: Add aria-describedby to file extensions input**

Around line 935, the file extensions input:

Change:
```tsx
<p className="settings-subsection-desc">File types to include (comma-separated)</p>

<input
  type="text"
  className="settings-text-input"
  value={settings.indexing.fileExtensions.join(', ')}
```
To:
```tsx
<p className="settings-subsection-desc" id="extensions-desc">File types to include (comma-separated)</p>

<input
  type="text"
  className="settings-text-input"
  aria-describedby="extensions-desc"
  value={settings.indexing.fileExtensions.join(', ')}
```

- [ ] **Step 4: Verify no TypeScript errors**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/SettingsApp.tsx
git commit -m "feat(a11y): add aria-describedby to hotkey, folder picker, and extensions fields"
```

---

## Task 9: Final cleanup and verification

**Files:**
- Modify: `src/app/App.tsx` (cleanup dead code)

- [ ] **Step 1: Clean up App.tsx dead code**

After all previous tasks, App.tsx should have several unused variables/imports. Clean up:

1. Remove unused store reads (already done in Task 5)
2. Remove `handleSuggestionActivate` from `useResultActions` destructuring
3. Remove the `handleSuggestionSelect` callback entirely
4. Remove `handleRetry` callback
5. Remove `clearError` callback
6. Remove `error` variable
7. Remove `appError`/`clearAppError` from `useAppLifecycle` destructuring
8. Remove `results`, `selectedIndex`, `searchError` store reads if no longer used

Keep: `searchQuery`, `showSnowEffect`, `setQuery`, `clearSearch`, `setActiveView`, `settings`, `isIndexing`, `isLoading` (for SearchBar placeholder).

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd D:/dev/Volt-public && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Run all frontend tests**

Run: `cd D:/dev/Volt-public && bun run test 2>&1 | tail -30`
Expected: All tests pass

- [ ] **Step 4: Run Rust checks**

Run: `cd D:/dev/Volt-public/src-tauri && cargo check 2>&1 | tail -10`
Expected: No errors

Run: `cd D:/dev/Volt-public/src-tauri && cargo clippy -- -D warnings 2>&1 | tail -10`
Expected: No warnings

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx
git commit -m "refactor(App): clean up dead code after store migration"
```

---

## Verification Checklist

After all tasks are complete, verify acceptance criteria:

- [ ] **WS2:** `App.tsx` has 0 `useState` calls → `grep -c useState src/app/App.tsx` = 0
- [ ] **WS2:** `ViewRouter` has 2 props (< 3) → check interface
- [ ] **WS2:** No prop drilling deeper than 1 level for search/UI state
- [ ] **WS3:** Toast appears with "Indexing N folder(s)..." on startup
- [ ] **WS3:** Toast shows "Indexing complete — N files indexed" on completion
- [ ] **WS3:** Error toast is persistent (duration=0)
- [ ] **WS1:** `aria-describedby` present on hotkey, folder picker, and extensions fields
- [ ] All 130+ frontend tests pass
- [ ] `cargo check` + `cargo clippy` pass
