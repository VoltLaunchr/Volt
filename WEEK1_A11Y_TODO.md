# 🎯 Week 1 Action Items — Accessibility Sprint

**Goal :** WCAG AA compliance (Contrast + Announcements + Focus)  
**Duration :** 2-4 days  
**Sprint Manager :** Task #3 & #16

---

## ✅ Already Done (Great!)

- ✅ SearchBar has `aria-label`, `aria-autocomplete`, `aria-controls`
- ✅ SearchBar has live region (`role="status"` + `aria-live="polite"`)
- ✅ ResultsList has `role="listbox"` + `aria-activedescendant` + `aria-selected`
- ✅ Tab key intercepted (autocomplete suggestion)
- ✅ Modal has focus trap (Tab cycling)
- ✅ Arrow keys work (↑↓)
- ✅ Enter to launch
- ✅ Escape to close

---

## 🚧 What Needs Immediate Work

### Task 1: SearchBar Additional Aria Labels

**File:** `src/features/search/components/SearchBar.tsx` (line 44-70)

**Change needed:** Add `aria-describedby` to help users understand keyboard shortcuts

```tsx
// Before:
<input
  aria-label={t('search.label')}
  aria-autocomplete="list"
  aria-controls="results-listbox"
/>

// After: Add aria-describedby pointing to a hint
<input
  aria-label={t('search.label')}
  aria-describedby="search-hint"  // NEW
  aria-autocomplete="list"
  aria-controls="results-listbox"
/>

// Add this hidden element:
<span id="search-hint" className="sr-only">
  Type to search. Use arrow keys to navigate results. Press Tab to autocomplete, 
  Enter to launch, Escape to close. Alt+1-9 to quick launch. Ctrl+P for preview.
</span>
```

**Estimation:** 10 min

---

### Task 2: Contrast Audit (HIGH PRIORITY)

**What to do:**
1. Open app: `bun run dev`
2. Open DevTools (F12)
3. Inspect a text element (search bar placeholder, result item text)
4. Right-click → Inspect
5. Look for "Contrast ratio" in the Styles panel
6. Should be **4.5:1 minimum** (normal text), **3:1** (disabled)

**Light Theme Check:**
```
- [ ] Search bar placeholder text: 4.5:1? ___
- [ ] Result item title: 4.5:1? ___
- [ ] Result item subtitle: 4.5:1? ___
- [ ] Button text (clear, context menu): 4.5:1? ___
- [ ] Disabled button: 3:1? ___
```

**Dark Theme Check:**
```
- [ ] Switch to dark theme (Settings > Appearance > Dark)
- [ ] Repeat checks above
```

**If any fail (<4.5:1):**
- Document the element + current ratio
- Adjust color in CSS
- Re-check

**Files to potentially edit:**
```
src/styles/theme.light.css
src/styles/theme.dark.css
src/styles/index.css
```

**Estimation:** 1-2 hours

---

### Task 3: aria-live Announcement for Selection

**File:** `src/app/App.tsx` OR `src/features/results/ResultsList.tsx`

**Current state:** Live region in SearchBar announces result count

**Add:** Announce when user navigates with arrow keys

**Implementation:**

Add to App.tsx or create a new component:

```tsx
// In App.tsx, add state tracking for announcements
const [ariaLiveMessage, setAriaLiveMessage] = useState('');

// In useGlobalHotkey.ts, add announcement on arrow key:
case KEYS.ARROW_DOWN:
  e.preventDefault();
  const newIndex = Math.min(selectedIndex + 1, maxIndex);
  setSelectedIndex(newIndex);
  // Announce new selection
  if (results[newIndex]) {
    setAriaLiveMessage(`Result ${newIndex + 1} of ${results.length}: ${results[newIndex].title}`);
  }
  break;

// Render the live region:
<div aria-live="polite" aria-atomic="true" className="sr-only">
  {ariaLiveMessage}
</div>
```

**Estimation:** 30 min

---

### Task 4: Install & Run axe Audit

**Steps:**
1. Install axe DevTools extension:
   - Chrome: https://chromedev.tools/extension/
   - Or search "axe DevTools" in Chrome Web Store
2. Open app: `bun run dev`
3. Open DevTools (F12)
4. Click "axe DevTools" tab
5. Click "Scan ALL of my page"
6. Document results:
   - Critical errors? (must fix)
   - Warnings? (should check)
   - Best practices? (nice to have)

**Expected:** Mostly green (no critical errors)

**If errors found:**
- Document them
- Create follow-up task if complex

**Estimation:** 30 min

---

### Task 5: Keyboard Navigation Full Test

**Manual testing:** Open app and go through this checklist

```
[ ] Launch: bun run dev
[ ] Focus starts in SearchBar ✓
[ ] Can type search query ✓
[ ] Results appear ✓

[ ] Arrow Down → next result selected ✓
[ ] Arrow Up → previous result selected ✓
[ ] Home → first result selected ✓
[ ] End → last result selected ✓

[ ] Tab (with result selected) → query fills with result title ✓
[ ] Enter → launches selected result ✓
[ ] Shift+Enter → launches as admin ✓
[ ] Ctrl+Enter → launches without closing window ✓
[ ] Escape → closes Volt ✓

[ ] Ctrl+K → clears search ✓
[ ] Ctrl+, → opens Settings ✓
[ ] Ctrl+P → toggles preview ✓
[ ] F1 → opens Help dialog ✓
[ ] ? → opens Help dialog ✓

[ ] Tab in Help dialog → cycles within dialog ✓
[ ] Escape in Help dialog → closes dialog ✓

[ ] Can access ResultsList without mouse ✓
[ ] No focus gets stuck ✓
```

**If any fail:**
- Document the issue
- Check console for errors
- Create follow-up task

**Estimation:** 30 min

---

## 📋 Daily Progress Template

**Day 1:**
- [ ] Task 1: SearchBar aria-describedby (10 min)
- [ ] Task 2: Contrast audit light theme (1 hour)
- [ ] Task 5: Keyboard navigation test (30 min)

**Day 2:**
- [ ] Task 2: Contrast audit dark theme + fixes (1 hour)
- [ ] Task 3: aria-live announcements (30 min)
- [ ] Task 4: axe audit (30 min)

**Day 3 (Optional):**
- [ ] Document all findings in `docs/A11Y_TEST_RESULTS.md`
- [ ] Create follow-up tasks for any issues
- [ ] PR: "Accessibility improvements for v1.0.1"

---

## 🔍 Audit Tools Quick Reference

| Tool | Purpose | Link |
|------|---------|------|
| **axe DevTools** | Automated a11y audit | Chrome Web Store |
| **WebAIM Contrast** | Check color ratio | https://webaim.org/resources/contrastchecker/ |
| **Chrome DevTools** | Native contrast ratio | F12 → Inspect → Styles → Computed |
| **NVDA** | Screen reader (Windows) | https://www.nvaccess.org/ |
| **VoiceOver** | Screen reader (macOS) | Built-in: Cmd+F5 |

---

## 📞 Questions?

- **Can't find contrast ratio?** → Elements tab → Styles panel → scroll to "Contrast ratio"
- **axe showing warnings?** → Document them, ask before fixing (some may be false positives)
- **Screen reader too quiet?** → Up volume, or use VoiceOver Utility to adjust speech rate

---

## 🎯 Success = All Checkboxes Checked

When this is done:
1. ✅ Contrast ratios verified (light + dark)
2. ✅ Live announcements added
3. ✅ axe audit passed (0 critical errors)
4. ✅ Keyboard navigation tested end-to-end
5. ✅ Results documented

→ **Ready to move to Performance (Day 1 of Week 2)**

Good luck! 🚀

