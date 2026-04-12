# Phase 2 — v1.x "Quality & Polish" Design Spec

**Date:** 2026-04-12
**Status:** Approved
**Scope:** 4 independent workstreams — Accessibility, Zustand Store, Indexing Indicator, Onboarding Modal

---

## WS1 — Accessibility (WCAG AA delta)

### Context
Audit shows ~65% coverage. Core patterns (listbox, focus trap, ARIA search) already implemented. This workstream closes the remaining gaps.

### Changes

**Contrast audit & fix:**
- Audit `light.css` — secondary text opacities (0.65, 0.55) must meet 4.5:1 ratio against backgrounds
- Verify dark theme variables in `variables.css` meet same ratios
- Fix any failing pairs

**Skip link:**
- Add invisible `<a href="#search-input" class="skip-link">Skip to search</a>` at top of App.tsx
- CSS: `position: absolute; left: -9999px` → visible on `:focus`
- Target: SearchBar input with `id="search-input"`

**Live region tuning:**
- SearchBar already has `aria-live="polite"` — verify announcements only fire after debounce settles (not on every keystroke)
- If announcing per-keystroke, gate announcements to fire only when results actually change

**Form descriptions:**
- Add `aria-describedby` to key form fields in SettingsApp where helpful (hotkey capture, folder picker)

### Files to modify
- `src/app/App.tsx` — skip link
- `src/styles/themes/light.css` — contrast fixes
- `src/styles/variables.css` — dark theme contrast fixes
- `src/features/search/components/SearchBar.tsx` — live region tuning
- `src/features/settings/SettingsApp.tsx` — aria-describedby
- New: `src/styles/accessibility.css` — skip-link styles

### Acceptance criteria
- Lighthouse a11y score > 90
- No color contrast ratio below 4.5:1 on both themes
- Full keyboard navigation works (Tab, Shift+Tab, arrows, Enter, Escape)
- Skip link visible on focus, jumps to search input

---

## WS2 — Zustand Store

### Context
16 useState calls across App.tsx + 3 hooks. ViewRouter receives 8+ props. Significant prop drilling.

### Store architecture

**`src/stores/searchStore.ts`**
```
State: searchQuery, results, selectedIndex, searchError, showSnowEffect
Actions: setQuery, performSearch, setSelectedIndex, navigateUp, navigateDown, clearSearch
```
Migrates from: `useSearchPipeline.ts`

**`src/stores/appStore.ts`**
```
State: settings, isIndexing, allApps, hasSeenOnboarding
Actions: loadSettings, updateSettings, startIndexing, setApps
```
Migrates from: `useAppLifecycle.ts`

**`src/stores/uiStore.ts`**
```
State: activeView, contextMenu, isPropertiesOpen, propertiesResult, isHelpOpen
Actions: setActiveView, openContextMenu, closeContextMenu, openProperties, closeProperties, toggleHelp
```
Migrates from: App.tsx useState calls

### Migration strategy
1. Install zustand
2. Create 3 store files
3. Refactor hooks to use stores internally (hooks become thin wrappers)
4. Remove prop drilling from App.tsx → ViewRouter → children
5. Components read stores directly via `useSearchStore()`, etc.

### Files to create
- `src/stores/searchStore.ts`
- `src/stores/appStore.ts`
- `src/stores/uiStore.ts`

### Files to modify
- `package.json` — add zustand
- `src/app/App.tsx` — remove useState, use stores
- `src/app/hooks/useSearchPipeline.ts` — delegate to searchStore
- `src/app/hooks/useAppLifecycle.ts` — delegate to appStore
- `src/app/components/ViewRouter.tsx` — read stores directly, remove props
- `src/features/results/components/ResultsList.tsx` — read from store

### Acceptance criteria
- Zero functional regression (all 130 frontend tests pass)
- App.tsx has 0 useState calls
- ViewRouter has < 3 props
- No prop drilling deeper than 1 level for search/UI state

---

## WS3 — Indexing Indicator

### Context
Backend has `IndexStatus` with `is_indexing`, `total_files`, `indexed_files`. SettingsApp polls during rebuild. No feedback during startup indexing. No toast system.

### Toast system

**`src/shared/components/ui/Toast.tsx`** (~80 lines)
- Position: fixed bottom-right
- Auto-dismiss: 5 seconds (configurable per toast)
- Stack: max 3 visible, FIFO
- Types: info, success, error
- Animation: slide-in from right, fade-out
- API: `useToast()` hook returning `{ showToast(message, type, duration?) }`
- State: managed internally via useState (or uiStore if WS2 lands first)

**`src/shared/components/ui/Toast.css`**
- Styles for toast container, types, animations

### Indexing progress integration

In `useAppLifecycle.ts` (or appStore after WS2):
- After calling `start_indexing`, start polling `get_index_status` every 2 seconds
- Show toast: "Indexing in progress... N files" (update existing toast)
- On completion: "Indexing complete — N files indexed" (success toast, 5s)
- On error: "Indexing failed" (error toast, persistent)
- Stop polling when `is_indexing === false`

### Files to create
- `src/shared/components/ui/Toast.tsx`
- `src/shared/components/ui/Toast.css`

### Files to modify
- `src/shared/components/ui/index.ts` — export Toast
- `src/app/hooks/useAppLifecycle.ts` — add polling + toast calls
- `src/app/App.tsx` — render Toast container

### Acceptance criteria
- Toast appears during startup indexing with file count
- Toast auto-dismisses after 5 seconds
- Max 3 toasts visible
- Success toast on completion

---

## WS4 — Onboarding Modal

### Context
No onboarding exists. No first-launch flag. Modal component with focus trap already available.

### Settings flag

Add to `GeneralSettings` interface:
- `hasSeenOnboarding: boolean` (default: `false`)

Rust side: add `has_seen_onboarding: bool` to `GeneralSettings` struct with `#[serde(default)]` for backward compat with existing settings.json files.

### Component

**`src/shared/components/ui/OnboardingModal.tsx`**

3-step modal:
1. **"Global Hotkey"** — Icon: Keyboard. Text: "Press Ctrl+Shift+Space anywhere to summon Volt. You can change this in Settings > Hotkeys."
2. **"File Indexing"** — Icon: FolderSearch. Text: "Volt indexes your files for instant search. Configure folders in Settings > Indexing."
3. **"Plugins"** — Icon: Puzzle. Text: "Calculator, emoji picker, web search, timer and more — just start typing."

Navigation: dots indicator + "Skip" button + "Next"/"Get Started" buttons
Uses existing Modal component as wrapper (inherits focus trap + a11y)
Icons from lucide-react (already a dependency)

**`src/shared/components/ui/OnboardingModal.css`**

### Trigger logic

In App.tsx (or appStore after WS2):
- On settings load, check `settings.general.hasSeenOnboarding`
- If `false`, render `<OnboardingModal onComplete={markOnboardingComplete} />`
- `markOnboardingComplete` calls `updateSettings({ general: { hasSeenOnboarding: true } })`

### Files to create
- `src/shared/components/ui/OnboardingModal.tsx`
- `src/shared/components/ui/OnboardingModal.css`

### Files to modify
- `src/features/settings/types/settings.types.ts` — add hasSeenOnboarding
- `src-tauri/src/commands/settings.rs` — add has_seen_onboarding to GeneralSettings struct
- `src/shared/components/ui/index.ts` — export OnboardingModal
- `src/app/App.tsx` — conditional render

### Acceptance criteria
- Modal shows on first launch
- 3 steps with navigation
- Skip works from any step
- After completion, modal never shows again
- Focus trapped inside modal
- Accessible (inherits Modal a11y)

---

## Dependencies between workstreams

```
WS2 (Zustand) ← no deps, can start immediately
WS1 (A11y) ← no deps, can start immediately
WS3 (Toast) ← benefits from WS2 but can use local state as fallback
WS4 (Onboarding) ← benefits from WS2 but can use settings directly
```

**Recommended order:** WS2 first (unblocks cleaner integration for WS3/WS4), then WS1/WS3/WS4 in parallel.

---

## Out of scope

- Dark theme CSS file creation (dark theme uses variables.css, not a separate file)
- Lighthouse CI integration (manual audit is sufficient)
- Tauri event emitters for indexing (polling is sufficient for now)
- Toast persistence across sessions
