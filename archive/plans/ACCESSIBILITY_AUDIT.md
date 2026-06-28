# ♿ Accessibility Audit — v1.0.1 Sprint

**Date :** 2026-04-14  
**Sprint :** Week 1 (2-4 days)  
**Goal :** WCAG AA compliance

---

## ✅ Already Implemented

### Patterns in place:
- ✅ **ResultsList** : `role="listbox"` + `aria-activedescendant` + `aria-selected`
- ✅ **ResultItem** : `role="option"`
- ✅ **SearchBar** : Live region (`role="status"` + `aria-live="polite"`)
- ✅ **Modal** : Focus trap (Tab cycling) + Escape to close
- ✅ **ErrorMessage** : `role="alert"`
- ✅ **Toast** : `role="status"`
- ✅ **HelpDialog** : `role="list"` for shortcuts

### Keyboard support:
- ✅ Arrow keys (↑↓) navigate results
- ✅ Enter to launch
- ✅ Escape to close
- ✅ Tab cycling in Modal

---

## 🚧 What Needs Work (v1.0.1)

### 1. **SearchBar Focus Management** (PRIORITY: HIGH)
**File:** `src/features/search/components/SearchBar.tsx`

**Current:** No focus trap, focus can escape to browser elements

**Required:**
- [ ] Focus trap: Tab should not escape to address bar
- [ ] Initial focus: SearchBar should auto-focus on app open
- [ ] Focus visible: Clear visual indicator of focus (outline)
- [ ] Announcement: "Search bar focused, type to search"

**Implementation:**
```tsx
// Add useEffect for initial focus
useEffect(() => {
  inputRef.current?.focus();
}, []);

// Add aria-label for context
<input aria-label="Search applications, files, and commands" />
```

**Test:** Tab from search → should cycle back to search (not escape)

---

### 2. **ResultItem Keyboard Handling** (PRIORITY: HIGH)
**File:** `src/features/results/components/ResultItem.tsx`

**Current:** Keyboard handling in App.tsx, not accessible from component

**Required:**
- [ ] `role="button"` should have `tabindex="0"` OR use `<button>`
- [ ] Click handler also handles Enter/Space
- [ ] Aria-label for context menu button

**Implementation:**
```tsx
// Instead of role="button" div, use actual button or add keyboard handler
<div
  role="button"
  tabIndex={isSelected ? 0 : -1}  // Only selected item is in tab order
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onLaunch();
    }
  }}
/>
```

---

### 3. **Color Contrast** (PRIORITY: MEDIUM)
**Files:** All `src/styles/` + theme files

**Required:**
- [ ] Test light theme: text vs background >= 4.5:1 (normal), >= 3:1 (large)
- [ ] Test dark theme: same ratios
- [ ] Disabled buttons: >= 3:1 ratio
- [ ] Focus outline: >= 3:1 vs background

**Tools:**
- Chrome DevTools: Elements > Styles > Computed > contrast ratio
- Axe DevTools extension: free a11y audit
- WebAIM contrast checker: https://webaim.org/resources/contrastchecker/

**Test Flow:**
1. Open app with light theme
2. DevTools > Inspect element on text
3. Check contrast ratio
4. Repeat for dark theme
5. Document any failures → fix colors

---

### 4. **Screen Reader Announcements** (PRIORITY: MEDIUM)
**Files:** Multiple

**Required:**
- [ ] "N results found" announcement after search
- [ ] "Loading..." during search
- [ ] "No results found" when empty
- [ ] Current selection announcement on arrow key

**Implementation (use aria-live):**
```tsx
// In SearchResults or App
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {results.length} results found. Use arrow keys to navigate.
</div>
```

**sr-only class** (screen reader only):
```css
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

---

### 5. **Help Dialog** (PRIORITY: LOW)
**File:** `src/shared/components/ui/HelpDialog.tsx`

**Current:** Exists, F1 opens it

**Required:**
- [ ] `aria-label` on dialog
- [ ] `aria-describedby` linking to description
- [ ] List items properly marked

**Check:** Already has `role="dialog"` and `role="list"` — likely OK

---

### 6. **Settings Modal** (PRIORITY: MEDIUM)
**File:** `src/features/settings/components/SettingsModal.tsx`

**Required:**
- [ ] Modal has `role="dialog"` ✓
- [ ] Modal has `aria-label` or `aria-labelledby` — **TO CHECK**
- [ ] Tab trap works (inherit from Modal component) ✓
- [ ] Form inputs have labels (`<label for="...">`)
- [ ] Disabled buttons announced

---

## 📋 Checklist for v1.0.1

- [ ] SearchBar focus trap implemented + tested
- [ ] ResultItem keyboard Enter/Space handling
- [ ] Contrast ratio audit: light + dark themes (document results)
- [ ] Aria-live announcements for search results
- [ ] SettingsModal aria-label added
- [ ] axe DevTools audit: 0 critical errors
- [ ] Manual keyboard navigation test:
  - [ ] Tab through entire app
  - [ ] Arrow keys in results
  - [ ] Enter to launch
  - [ ] Escape to close
- [ ] Screen reader test (NVDA/JAWS on Windows OR VoiceOver on macOS)

---

## 🔧 Tools for Testing

**Automated:**
- axe DevTools: https://www.deque.com/axe/devtools/ (free Chrome extension)
- WAVE: https://wave.webaim.org/ (free web tool)
- Lighthouse (Chrome DevTools > Accessibility tab)

**Manual:**
- Keyboard navigation: Tab, Shift+Tab, arrow keys, Enter, Escape
- Screen reader:
  - Windows: NVDA (free) https://www.nvaccess.org/
  - macOS: VoiceOver (built-in, Cmd+F5)
  - Linux: Orca (built-in on most distros)

**Color Contrast:**
- WebAIM: https://webaim.org/resources/contrastchecker/
- Chrome DevTools Inspect > Styles > Computed > contrast

---

## 📏 WCAG AA Standards

**Level AA = Industry standard**

Key requirements met already:
- ✅ 1.4.3 Contrast (normal) — 4.5:1 (TO VERIFY)
- ✅ 2.1.1 Keyboard — all functionality keyboard accessible
- ✅ 2.1.2 No Keyboard Trap — standard (to verify SearchBar)
- ✅ 2.4.3 Focus Order — logical (arrow keys + Tab)
- ✅ 2.4.7 Focus Visible — visible outline (TO VERIFY)
- ✅ 4.1.2 Name Role Value — ARIA labels present (TO VERIFY)

---

## 🎯 Success Criteria

**Before shipping v1.0.1:**
1. ✅ axe audit: 0 critical errors
2. ✅ Keyboard navigation: full coverage (no traps, all functions accessible)
3. ✅ Contrast: >= 4.5:1 normal text, >= 3:1 disabled/large
4. ✅ Screen reader: key announcements work
5. ✅ Focus visible: clear outline on all interactive elements

---

## 📊 Estimation

| Task | Days |
|------|------|
| SearchBar focus + ResultItem keyboard | 1 day |
| Contrast audit + fixes | 0.5 days |
| Aria-live announcements | 0.5 days |
| Testing + documentation | 1 day |
| **Total** | **3 days** |

**Actual:** 2-4 days (depending on issues found)

