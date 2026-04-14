# ♿ Accessibility Settings — Implementation Plan

**Goal:** Add dedicated Accessibility section in Settings with toggleable features  
**Duration:** 2-3 days (replaces manual WCAG fixes)  
**Approach:** User-controlled, opt-in features

---

## 🎯 Settings Page Structure

Add new tab in `src/features/settings/components/SettingsApp.tsx`:

```
Settings Tabs:
├─ General
├─ Appearance
├─ Hotkeys
├─ Indexing
├─ Plugins
├─ Shortcuts
└─ ♿ ACCESSIBILITY (NEW)    ← Add this
```

---

## 🔧 Accessibility Toggles

### 1. **Screen Reader Mode** (Default: OFF)
```
Toggle: Enable screen reader optimization
└─ What it does:
   - Aria-live announcements for every action
   - Verbose button labels
   - Announces result count on every search
   - Works with: NVDA, JAWS, VoiceOver
```

**Implementation:**
- Add `screenReaderMode` to `AppSettings` type
- Wrap announcements with `if (settings.accessibility.screenReaderMode) { ... }`
- Store in `~/.config/Volt/settings.json`

---

### 2. **High Contrast Mode** (Default: OFF)
```
Toggle: Use high contrast colors
└─ What it does:
   - Black text on white (light)
   - White text on black (dark)
   - Larger focus outlines (4px instead of 2px)
   - No transparency/glassmorphism
```

**Implementation:**
- Add CSS variable: `--high-contrast: false`
- CSS rule: `html[data-high-contrast="true"] { ... }`
- Apply to:
  - Text colors: increase contrast
  - Outlines: thicker + more visible
  - Remove transparency effects

---

### 3. **Focus Indicators** (Default: ON for a11y users)
```
Toggle: Always show focus outline (even for mouse users)
└─ What it does:
   - Show visible focus ring on all interactive elements
   - Helpful for keyboard navigation
   - Can be distracting if you use mouse
```

**Implementation:**
- Add `:focus-visible` CSS
- Thicker outline (3-4px)
- High contrast color (yellow/orange)

---

### 4. **Reduce Motion** (Default: ON for users who enable it)
```
Toggle: Reduce animations and transitions
└─ What it does:
   - Disable smooth scroll
   - Disable fade animations
   - Disable transition effects
   - Help users with vestibular disorders
```

**Implementation:**
- CSS: `prefers-reduced-motion: reduce`
- Add JS check: `window.matchMedia('(prefers-reduced-motion: reduce)')`
- Apply `--motion-enabled: false` CSS variable

---

### 5. **Text Scaling** (Default: 100%)
```
Dropdown: [100%, 110%, 120%, 130%, 150%]
└─ What it does:
   - Font size increases across app
   - Layout adapts (no overflow)
   - Works with high contrast mode
```

**Implementation:**
- Add CSS variable: `--text-scale: 1`
- HTML: `font-size: calc(16px * var(--text-scale))`
- Store setting + apply on load

---

### 6. **Keyboard Shortcuts Guide** (Default: OFF)
```
Toggle: Show keyboard shortcuts overlay
└─ What it does:
   - Persistent help showing all shortcuts
   - Can be toggled with Ctrl+?
   - Shows in bottom corner or sidebar
```

**Implementation:**
- Add `showKeyboardGuide` toggle
- Render: `<KeyboardShortcutsOverlay />`
- Show in Settings or side panel

---

## 📁 Files to Create/Modify

### New Files:
```
src/features/settings/components/AccessibilityTab.tsx       [NEW]
src/features/settings/hooks/useAccessibilitySettings.ts     [NEW]
src/styles/accessibility.css                                [NEW]
```

### Modified Files:
```
src/features/settings/components/SettingsApp.tsx
  └─ Add tab: "Accessibility" + import AccessibilityTab

src/features/settings/types/settings.types.ts
  └─ Add: AccessibilitySettings interface

src/shared/types/common.types.ts
  └─ Add: accessibility field to AppSettings

src/app/App.tsx
  └─ Apply accessibility settings on mount
  └─ Add data-high-contrast, data-text-scale attributes to <html>

src/styles/index.css
  └─ Import accessibility.css
```

---

## 💾 Settings Schema

Add to `AppSettings` type:

```typescript
interface AccessibilitySettings {
  // Screen reader
  screenReaderMode: boolean;           // Default: false
  announceResults: boolean;            // Default: true (if screenReaderMode)
  verboseLabels: boolean;              // Default: true (if screenReaderMode)
  
  // Visuals
  highContrastMode: boolean;           // Default: false
  focusIndicators: boolean;            // Default: true
  textScale: number;                   // Default: 1 (1.0 = 100%, 1.2 = 120%)
  
  // Animation
  reduceMotion: boolean;               // Default: false (respects system preference)
  
  // UI
  showKeyboardGuide: boolean;          // Default: false
}
```

---

## 🎨 High Contrast Mode CSS

```css
html[data-high-contrast="true"] {
  /* Light theme */
  --color-text: #000000;
  --color-bg: #ffffff;
  --color-border: #000000;
  
  /* Remove transparency */
  --opacity-modal: 1;
  --opacity-bg: 1;
}

html[data-high-contrast="true"][data-theme="dark"] {
  /* Dark theme */
  --color-text: #ffffff;
  --color-bg: #000000;
  --color-border: #ffffff;
}

/* Focus ring */
html[data-accessibility-focus="true"] *:focus-visible {
  outline: 4px solid #ffaa00;
  outline-offset: 2px;
}
```

---

## 🎯 Implementation Steps

### Day 1: Create Settings UI
- [ ] Create `AccessibilityTab.tsx` component
- [ ] Add toggles for: screenReaderMode, highContrastMode, focusIndicators, reduceMotion
- [ ] Add dropdown for: textScale (100%, 110%, 120%, 130%, 150%)
- [ ] Wire up to Settings state

### Day 2: Apply Settings
- [ ] Add `useAccessibilitySettings` hook
- [ ] In `App.tsx`: read settings on mount
- [ ] Apply CSS variables: `data-high-contrast`, `data-text-scale`
- [ ] Persist settings to JSON

### Day 3: Test + Polish
- [ ] Test each toggle
- [ ] Test high contrast with all themes (light + dark)
- [ ] Test text scaling (no overflow)
- [ ] Test keyboard navigation with all settings
- [ ] PR + documentation

---

## 📋 UI Layout Example

```
Settings > ♿ Accessibility

┌─ SCREEN READER MODE ──────────────────┐
│ [Toggle] Enable screen reader         │
│ ℹ️ Optimizes announcements for blind   │
│     and low-vision users              │
│                                       │
│ └─ [Toggle] Announce search results   │
│ └─ [Toggle] Verbose button labels     │
├─────────────────────────────────────────┤
│ ♥ HIGH CONTRAST MODE ──────────────────┤
│ [Toggle] Use high contrast colors      │
│ ℹ️ Increases text/background contrast  │
│     for low-vision users               │
├─────────────────────────────────────────┤
│ ◉ FOCUS INDICATORS ────────────────────┤
│ [Toggle] Always show focus outline     │
│ ℹ️ Helpful for keyboard navigation     │
├─────────────────────────────────────────┤
│ ≈ REDUCE MOTION ───────────────────────┤
│ [Toggle] Reduce animations             │
│ ℹ️ Helps with vestibular disorders     │
├─────────────────────────────────────────┤
│ A TEXT SCALING ────────────────────────┤
│ [100% ▼] [110% 120% 130% 150%]         │
│ Preview: This text is scaled           │
├─────────────────────────────────────────┤
│ ⌨️ KEYBOARD GUIDE ──────────────────────┤
│ [Toggle] Show keyboard shortcuts       │
│ ℹ️ Persistent help with all shortcuts  │
└─────────────────────────────────────────┘

[← Back] [Default]        [Save]
```

---

## 🧪 Testing Checklist

- [ ] Screen reader mode:
  - [ ] NVDA (Windows) announces results
  - [ ] VoiceOver (macOS) announces results
  
- [ ] High contrast:
  - [ ] Light + dark themes both work
  - [ ] No white-text-on-white issues
  - [ ] Glassmorphism removed
  
- [ ] Text scaling:
  - [ ] 100%, 120%, 150% all display correctly
  - [ ] No overflow or layout breaks
  - [ ] Search bar still functional
  
- [ ] Focus indicators:
  - [ ] Visible on all focusable elements
  - [ ] Keyboard navigation works
  - [ ] Mouse users can toggle off
  
- [ ] Reduce motion:
  - [ ] Smooth scroll disabled
  - [ ] Fade animations gone
  - [ ] App feels snappier

---

## 🚀 Benefits of This Approach

✅ **Modular:** Each feature independent  
✅ **User-controlled:** Can enable/disable as needed  
✅ **Documented:** Each setting has help text  
✅ **Non-breaking:** Off by default, doesn't affect existing users  
✅ **Testable:** Each toggle can be tested independently  
✅ **Maintainable:** Settings in one place  

---

## 📞 When User Enables Features

The app will:
1. Load settings from `settings.json`
2. Apply CSS variables (high contrast, text scale)
3. Enable aria-live announcements (screen reader mode)
4. Show focus outlines (keyboard mode)
5. Disable animations (reduce motion)

All automatically, just from toggles in Settings! 🎉

---

## 🎯 Success Criteria

When done, v1.0.1 will have:
- ✅ Dedicated Accessibility settings tab
- ✅ 6 major toggles for different disabilities
- ✅ Settings persist across restarts
- ✅ Works with WCAG AA standards
- ✅ Tested with real a11y tools

This beats the manual approach of trying to make everything accessible by default. 
Now users get what they need! 🚀

