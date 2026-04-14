# 🎯 Week 1 Revised Plan — Accessibility Settings First

**Better approach:** Instead of trying to make everything WCAG AA for everyone,  
create **Settings toggles** so users can enable what they need.

**Duration:** 2-3 days | **Estimation:** 3 tasks

---

## 🔄 What Changed

### ❌ Old Approach (Harder)
- Fix contrast ratios globally
- Force aria-live announcements everywhere
- Try to satisfy everyone

### ✅ New Approach (Smarter)
- Create Accessibility Settings tab
- User enables Screen Reader Mode → announcements activate
- User enables High Contrast → colors change
- Users get what they need, nothing forced

---

## 📋 Week 1 Tasks (in order)

### **Task 1: Create AccessibilityTab.tsx** (1 day)

**File:** `src/features/settings/components/AccessibilityTab.tsx`

**What to build:**
```
Settings > ♿ ACCESSIBILITY

[Toggle] Screen Reader Mode
  └─ ℹ️ Enables announcements for NVDA, JAWS, VoiceOver

[Toggle] High Contrast Mode
  └─ ℹ️ Black/white colors, no transparency

[Toggle] Focus Indicators
  └─ ℹ️ Always show focus outline

[Toggle] Reduce Motion
  └─ ℹ️ Disable animations

[Dropdown] Text Scaling: 100% | 110% | 120% | 130% | 150%
  └─ Preview text that scales

[Toggle] Show Keyboard Guide
  └─ ℹ️ Persistent help with shortcuts

[Reset to Defaults] [Save]
```

**Time:** 4-6 hours (UI + state management)

---

### **Task 2: Wire Settings to App** (1 day)

**What to do:**

1. **Add to settings types** (`src/features/settings/types/settings.types.ts`):
```typescript
interface AccessibilitySettings {
  screenReaderMode: boolean;      // Default: false
  announceResults: boolean;       // Default: true (when SR mode on)
  highContrastMode: boolean;      // Default: false
  focusIndicators: boolean;       // Default: true
  reduceMotion: boolean;          // Default: false
  textScale: number;              // Default: 1 (100%)
  showKeyboardGuide: boolean;     // Default: false
}
```

2. **In App.tsx, on mount:**
```typescript
useEffect(() => {
  const settings = useSettingsStore.getState().accessibility;
  
  // Apply high contrast
  if (settings.highContrastMode) {
    document.documentElement.setAttribute('data-high-contrast', 'true');
  }
  
  // Apply text scale
  document.documentElement.style.setProperty('--text-scale', settings.textScale);
  
  // Enable announcements
  if (settings.screenReaderMode) {
    document.documentElement.setAttribute('data-screen-reader', 'true');
  }
}, []);
```

3. **Create CSS variables** (`src/styles/accessibility.css`):
```css
/* High contrast */
html[data-high-contrast="true"] {
  --text-color: #000000;
  --bg-color: #ffffff;
  --opacity: 1;  /* No transparency */
}

/* Text scaling */
html {
  font-size: calc(16px * var(--text-scale, 1));
}

/* Focus visible */
html[data-accessibility-focus="true"] *:focus-visible {
  outline: 4px solid #ffaa00;
  outline-offset: 2px;
}
```

**Time:** 4-5 hours (settings persistence + CSS)

---

### **Task 3: Test + Document** (4-6 hours)

**What to test:**

- [ ] Enable Screen Reader Mode
  - [ ] Open NVDA or VoiceOver
  - [ ] Search for something
  - [ ] Verify announcements work
  
- [ ] Enable High Contrast
  - [ ] Light theme: black on white ✓
  - [ ] Dark theme: white on black ✓
  - [ ] No transparency effects
  
- [ ] Enable Reduce Motion
  - [ ] Smooth scroll disabled
  - [ ] No fade animations
  
- [ ] Text Scaling
  - [ ] 100%, 120%, 150% all work
  - [ ] No layout overflow
  - [ ] Settings persist on restart
  
- [ ] Focus Indicators
  - [ ] Tab through app
  - [ ] Clear outline visible
  
- [ ] Keyboard Guide
  - [ ] Shows/hides with toggle
  - [ ] Lists all shortcuts

**Document:** Create `docs/A11Y_SETTINGS_TEST_RESULTS.md`

---

## 📅 Daily Breakdown

**Day 1 (4-6 hours):**
- [ ] Create AccessibilityTab.tsx with all toggles
- [ ] Add form state management
- [ ] Wire up Save button

**Day 2 (4-5 hours):**
- [ ] Add settings to AppSettings type
- [ ] Implement in App.tsx (CSS variables + attributes)
- [ ] Create accessibility.css
- [ ] Test persistence

**Day 3 (4-6 hours):**
- [ ] Full keyboard navigation test
- [ ] Test with NVDA/VoiceOver
- [ ] Fix any issues
- [ ] Document results
- [ ] Create PR

---

## 🎯 Success Criteria

When done:
- ✅ Settings > Accessibility tab exists
- ✅ All 6 toggles work
- ✅ Settings persist across restarts
- ✅ High contrast tested (light + dark)
- ✅ Screen reader mode tested (NVDA/VoiceOver)
- ✅ Text scaling tested (no overflow)
- ✅ Full keyboard test passed
- ✅ Zero console errors

---

## 💡 Why This Approach is Better

| Aspect | Old Approach | New Approach |
|--------|---|---|
| **Complexity** | Try to fix everything | Users enable what they need |
| **Testing** | Test all combos (hard) | Test toggles individually (easy) |
| **Maintenance** | Maintain global rules | Maintain CSS variables |
| **UX** | One-size-fits-all | Personalized |
| **Time** | 2-4 weeks | 2-3 days |

---

## 🚀 Next Steps (Week 2)

After this is done:
- Performance benchmark (1 day)
- Marketplace UI (3-4 days)
- Done with v1.0.1 accessibility! 🎉

---

## 📞 Need Help?

**Can't find where to add Settings tab?**
→ Look at `src/features/settings/components/SettingsApp.tsx` (tabs are there)

**How to apply CSS variables?**
→ `document.documentElement.style.setProperty('--variable-name', value)`

**How to persist to settings.json?**
→ Look at how other settings do it (e.g., theme, hotkeys)

Good luck! 🚀

