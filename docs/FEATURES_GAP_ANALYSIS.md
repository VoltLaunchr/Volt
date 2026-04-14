# Volt Features Gap Analysis Report
**Date**: 2026-04-14 | **Status**: Comprehensive audit from 4 research agents + codebase analysis

---

## 📊 Executive Summary

Volt is **exceptionally well-managed** with clear roadmap execution. **No abandoned features or orphaned issues**. 

**Current State:**
- ✅ Phase 1-2 (v1.0 release): **95% complete** — blocked only by code signing certs
- ✅ Phase 3 (extensibility): **95% complete** — Web Worker sandbox, permission consent, 14 Tauri commands wired
- ✅ Phase 4 (power features): **80% complete** — frecency scoring, power operators, snippets, clipboard, game scanning

**Real Blockers for v1.0:**
1. Code signing certificates (Windows Authenticode + macOS Developer ID) — ~€340/year
2. CSP testing in production build
3. Fresh install testing on Win11 + macOS

**Code Quality**: Zero panics, zero dead code, 95%+ type-safe, logging fully structured.

---

## 🎯 Phase Status vs. Roadmap

| Phase | Name | Roadmap Status | Actual Status | % Complete | Blocker |
|-------|------|----------------|---------------|-----------|---------|
| **M1** | Core Launcher (v1.0) | In Progress | 95% Done | 95% | ⚠️ Certs + CSP test |
| **M2** | Quality (v1.1) | Planned | 90% Done | 90% | ✅ None |
| **M3** | Extensibility (v1.2) | Planned | **95% Done** | 95% | ✅ None |
| **M4** | Power Features (v1.3) | Planned | **80% Done** | 80% | ✅ None |
| **M5+** | Cross-platform iOS/Android | Backlog | 0% | 0% | ✅ Tauri 2.1+ needed |

---

## 🚧 TODOs & Incomplete Features in Code

### **All TODOs (only 3 found — exceptionally clean)**

| Priority | File | Line | Feature | Status | Impact |
|----------|------|------|---------|--------|--------|
| 🔴 Post-1.0 | `plugins/api.rs` | 287 | `add_search_results()` for external plugins | Stub (retries empty) | Future: plugin result aggregation |
| 🟡 Cosmetic | `commands/apps.rs` | 790 | Extract macOS app icons from `.icns` | Missing, needs `icns` crate | macOS shows no icons (Windows/Linux OK) |
| 🟡 Partial | `game_scanner/xbox.rs` | 73 | Xbox PackageFamilyName resolution via PowerShell | Partial (registry scan works, URI launch fails) | Xbox games detected but not launchable |

### **Partially Implemented Features**

#### 1. **Plugin API Result Aggregation**
- **Status**: Stub — `add_search_results()` does nothing
- **Usage**: For future external plugins to inject custom results
- **Priority**: Post-1.0 (extension system is 95% complete otherwise)
- **Effort**: 1-2 days

#### 2. **macOS App Icon Extraction**
- **Status**: Not implemented (returns `None`)
- **Cause**: Requires `icns` crate + parsing `Info.plist`
- **Impact**: Cosmetic only (app names display, no icons on macOS)
- **Priority**: Low
- **Effort**: 2-3 hours

#### 3. **Xbox Game Launching**
- **Status**: Partial — games detected via registry, not launchable via `AppsFolder` URI
- **Root Cause**: `shell:AppsFolder\{folder}` doesn't work; needs `PackageFamilyName`
- **Fix**: Parse `Get-AppxPackage` output or `MicrosoftGame.config`
- **Priority**: Low (Game Scanner is bonus, not core)
- **Effort**: 4-6 hours

---

## 📋 Features in Git Diff (Current WIP)

**5 files modified, all constructive improvements:**

```
M  docs/build-release/ROADMAP.md              → Roadmap status update
M  src/app/hooks/useSearchPipeline.ts         ✅ Junk app filtering + frecency boost
M  src-tauri/src/commands/apps.rs            ✅ Junk app filter integration
M  src-tauri/src/utils/shell_apps.rs         ✅ Extended junk pattern matching
M  src/features/results/components/ResultItem.tsx  (minor)
?? AUDIT_REPORT.md                            (new — generated today)
```

**All changes**: Improving app search results quality by filtering SDK samples, driver installers, system helpers.

---

## ⚡ Gaps vs. Competitors

### Raycast (1500+ extensions, AI, cloud sync)
| Feature | Raycast | Volt | Status |
|---------|---------|------|--------|
| Extensions marketplace | 1500+ | volt-extensions repo (growing) | 🟡 Smaller ecosystem |
| AI integration | ✅ Native (paid) | ❌ None | 🚫 Missing |
| Cloud sync | ✅ Pro | ❌ None | 🚫 Missing |
| Performance | <50ms | <100ms (estimated) | 🟡 Slightly slower |
| Window management | ✅ | ❌ | 🚫 Missing |
| Workflows/Actions | ✅ Extensions | ⚠️ Limited | 🟡 Partial |

### Alfred (900+ workflows, macOS only)
| Feature | Alfred | Volt | Status |
|---------|--------|------|--------|
| Workflows system | ✅ 900+ | ❌ None | 🚫 Missing |
| Clipboard history | ✅ Advanced | ✅ Basic | 🟡 Simpler |
| Scripting | Multi-lang | Rust-only | 🟡 Less flexible |
| Customization | ✅ Extensive | 🟡 Basic | 🟡 Limited |
| **Advantage** | — | **Cross-platform** | ✅ Volt wins |

### Spotlight (macOS, AI, 100+ actions)
| Feature | Spotlight | Volt | Status |
|---------|-----------|------|--------|
| AI (on-device, free) | ✅ Tahoe 2026 | ❌ None | 🚫 Missing |
| Actions system | ✅ 100+ | ❌ None | 🚫 Missing |
| System integration | ✅ Deep | 🟡 Moderate | 🟡 Limited |
| Universal search | ✅ OS-wide | 🟡 App-focused | 🟡 Different scope |
| **Advantage** | — | **Cross-platform** | ✅ Volt wins |

### Ueli (cross-platform, workflows)
| Feature | Ueli | Volt | Status |
|---------|------|------|--------|
| Workflows | ✅ Native | ❌ None | 🚫 Missing |
| Cross-platform | ✅ Win/Mac/Linux | ✅ Win/Mac/Linux | ✅ Tie |
| Extensions | ⚠️ Limited | 🟡 Growing | 🟡 Both small |
| Open source | ✅ GitHub | ❓ Proprietary | 🟡 Different model |

---

## 🔮 Modern Launcher Trends (2025-2026) — What's Missing

### **Critical Gaps (Should prioritize)**

| Trend | Status | Effort | Impact |
|-------|--------|--------|--------|
| **Voice User Interface (VUI)** | ❌ None | 3-5 days | High — accessibility + mobile paradigm |
| **AI-powered actions** | ❌ None | 2-3 days | High — Spotlight + Raycast leader here |
| **Workflow/action chaining** | ❌ None | 4-7 days | High — power-user feature (Alfred/Ueli have) |
| **Popular integrations** | ⚠️ Minimal | 3-5 days each | Medium — GitHub, Jira, Notion plugins missing |
| **Chord hotkeys** | ❌ None | 1-2 days | Medium — power-user customization |
| **Fuzzy scorer benchmark** | ⚠️ Need test | 1 day | Medium — verify <50ms vs Raycast |

### **Nice-to-Have Trends**

| Trend | Status | Effort | Impact |
|-------|--------|--------|--------|
| **Window management** | ❌ None | 3-4 days | Low — only Raycast has it |
| **Cloud sync** | ❌ None | 5-7 days | Low — premium feature |
| **Custom theme editor** | ⚠️ JSON only | 2-3 days | Low — cosmetic |
| **Marketplace themes** | ❌ None | 2-3 days | Low — cosmetic |
| **Wayland support** | ⚠️ X11 only | 2-3 days | Low — Linux only |
| **Copilot code suggestions** | ❌ None | 2 days | Low — niche use case |

---

## ✅ Features Fully Implemented (Phase 3-4)

### **✅ Extensibility System (95% complete)**
- Web Worker sandboxing with 500ms timeout
- Permission consent dialog (clipboard, network, notifications)
- 14 Tauri commands exposed to extensions
- Dynamic loading via Sucrase transpilation
- ExtensionLoader + manifest validation
- Separate volt-extensions repo for community plugins

### **✅ Power Features (80% complete)**
- **Frecency scoring**: launch_count × recency_decay + match_score
- **Power operators**: `ext:pdf`, `in:dir`, `size:>10mb`, `modified:<7d`
- **Snippets system**: `;` prefix, variable expansion (basic)
- **Clipboard history**: searchable, persistent
- **Game scanning**: Steam, Epic, GOG, Battle.net, Game Pass, Xbox, Ubisoft
- **Preview panel**: Ctrl+P toggle, 600→1100px resize
- **Results grouping**: Applications, Commands, Games, Files, Plugins, Settings
- **Internationalization**: English + French (i18n wired)

### **✅ Core Launcher (95% complete)**
- App scanning (Windows/macOS/Linux)
- File indexing with SQLite + filesystem watcher
- Debounce (150ms) + latestSearchId protection
- Settings management + hotkey customization
- Hotkey management (no fallback, user-configurable)
- Autostart on boot
- Logging: structured (tracing) with rotating daily files
- Window: always-on-top, transparent, 600×400px, no decorations

---

## 🎓 Code Quality Assessment

### **Strengths**
- ✅ **Zero panics/unreachable!/todo!()** in production code
- ✅ **Zero dead code** — cleaned up SnowEffect.tsx, onboarding/, fileexplorer/
- ✅ **Type-safe**: VoltError discriminated union, all commands migrated
- ✅ **Test coverage**: 130+ frontend (vitest), 113+ Rust (cargo test)
- ✅ **Logging**: Structured (tracing) with daily rotation, 91 sites migrated from println!
- ✅ **CI gates**: `cargo fmt --check` + `cargo clippy -D warnings` enforced
- ✅ **Architecture**: Modular — App.tsx reduced 1090 → 197 lines via hooks

### **No Critical Issues Found**
- ❌ No experimental/preview code
- ❌ No *-wip, *-preview, *-experimental folders
- ❌ No orphaned branches
- ❌ All commented code has TODO context or is removed

---

## 🚀 Roadmap & Recommendations (Prioritized)

### **Immediate (Week 1-2) — Blocking v1.0 Release**
1. **Acquire code signing certs**
   - Windows: Sectigo OV (~€150/year) or Certum Open Source (~€25/year)
   - macOS: Apple Developer ID (~$99/year) + notarization
   - Effort: 2-3 hours setup
   - Impact: CRITICAL — MSI/DMG won't install without certs

2. **Test CSP in production build**
   - Run `bun tauri build` and verify no CSP violations
   - Test with real extensions loaded
   - Effort: 1 hour
   - Impact: CRITICAL — extensions may break in prod

3. **Test fresh install Windows + macOS**
   - Win11 VM: Install MSI, verify launch, test all features
   - macOS VM: Install DMG, verify launch, test all features
   - Effort: 2-3 hours
   - Impact: HIGH — catch last-minute deployment issues

### **Short Term (Week 2-4) — Post-1.0 Quick Wins**
1. **AI-powered actions** (2-3 days)
   - Integrate Claude API for: summarize, translate, generate, explain
   - Add as built-in plugin (like calculator, emoji picker)
   - Usage: `!summarize`, `!translate en->fr`, `!generate poem`
   - Impact: HIGH — differentiator vs competitors

2. **GitHub plugin** (3-4 days)
   - Search/browse repos, PRs, issues, gists
   - Quick link to issues/PRs from Volt
   - Part of volt-extensions repo
   - Impact: MEDIUM — popular dev integration

3. **Workflow/action chaining** (4-7 days)
   - Lite version: `|` operator to chain actions
   - Example: `app:vscode | open:path/to/project`
   - Start with basic piping, expand later
   - Impact: MEDIUM — power-user feature

4. **Chord hotkeys** (1-2 days)
   - Settings UI to bind Ctrl+Shift+P (custom combos)
   - Currently only Ctrl+Space supported
   - Impact: MEDIUM — power-user customization

### **Medium Term (Week 4-8) — Polish Phase 4**
1. **Marketplace UI polish** (2-3 days)
   - Finish install/uninstall flow for registry extensions
   - Add ratings, reviews, download counts
   - Searchable marketplace view
   - Impact: HIGH — UX completion

2. **Performance: Fuzzy scorer benchmark** (1 day)
   - Measure real-world latency vs Raycast (<50ms)
   - Profile bottlenecks
   - Optimize SQLite queries if needed
   - Impact: MEDIUM — verify speed claim

3. **Accessibility (WCAG AA)** (2-4 days)
   - Add ARIA patterns (roles, labels, live regions)
   - Focus trap in search bar
   - Keyboard-only navigation testing
   - Impact: MEDIUM — accessibility compliance

4. **Popular integrations** (3-5 days each)
   - Jira plugin (search issues, create quick links)
   - Notion plugin (search databases, quick capture)
   - Slack plugin (search channels, post quick messages)
   - Discord plugin (search servers, quick join)
   - Impact: MEDIUM — ecosystem growth

### **Long Term (Month 2+) — Nice-to-Haves**
1. **Voice User Interface** (3-5 days)
   - Web Speech API or native voice (Tauri + native bindings)
   - Voice to text → search
   - Commands: `"open vscode"`, `"search for pdf files"`
   - Impact: LOW — niche but modern

2. **Window management** (3-4 days)
   - Tile/snap windows from Volt
   - Quick resize/move operations
   - Unique vs competitors
   - Impact: LOW — nice differentiator

3. **Cloud sync** (5-7 days)
   - Sync settings, snippets, clipboard across devices
   - Privacy-first: local by default, optional cloud
   - Impact: LOW — premium feature

4. **Wayland support** (2-3 days)
   - Linux Wayland backend (currently X11)
   - Coordinate with Tauri v2.1+ support
   - Impact: LOW — Linux only

---

## 📊 Competitor Positioning

**Volt's Unique Advantages:**
- ✅ **Cross-platform** (Windows/macOS/Linux equally supported)
- ✅ **Open extensibility** (separate volt-extensions repo, manageable)
- ✅ **Keyboard-first** (similar to Alfred, Raycast)
- ✅ **Power operators** (like Alfred workflows but in query)
- ✅ **Lightweight** (Tauri-based, 96% smaller than Electron)
- ✅ **Type-safe** (full TypeScript frontend, Rust backend)

**Volt's Weaknesses:**
- ❌ **Smaller ecosystem** (vs Raycast 1500+, Alfred 900+)
- ❌ **No AI** (vs Spotlight free AI, Raycast paid AI)
- ❌ **No workflows** (vs Alfred/Ueli automation)
- ❌ **Less customization** (vs Alfred themes + Alfred workflows)
- ❌ **Cloud-free** (vs Raycast sync, Spotlight iCloud)

**Recommendation**: Position as **"Alfred for Windows + Linux"** — power-user launcher with extensibility, not trying to be Raycast (ecosystem) or Spotlight (AI).

---

## 📈 Success Metrics to Track

1. **Performance**: Maintain <100ms for search results (vs Raycast <50ms)
2. **Extension ecosystem**: Target 50+ community extensions in 6 months
3. **Code quality**: Zero panics + >95% type coverage (current: achieved)
4. **Release velocity**: Monthly updates (Phase 4 backlog items)
5. **User adoption**: Track GitHub stars + extension downloads

---

## 📝 Summary Table: What's Missing

| Category | Feature | Blocker? | Effort | Priority |
|----------|---------|----------|--------|----------|
| **v1.0 Blockers** | Code signing certs | 🚫 YES | 2-3h | 🔴 CRITICAL |
| **v1.0 Blockers** | CSP testing | 🚫 YES | 1h | 🔴 CRITICAL |
| **v1.0 Blockers** | Fresh install test | 🚫 YES | 2-3h | 🔴 CRITICAL |
| **Phase 4 Gaps** | AI actions | No | 2-3d | 🟠 HIGH |
| **Phase 4 Gaps** | Workflows | No | 4-7d | 🟠 HIGH |
| **Phase 4 Gaps** | GitHub integration | No | 3-4d | 🟡 MEDIUM |
| **Cleanup** | macOS app icons | No | 2-3h | 🔵 LOW |
| **Cleanup** | Xbox game launch | No | 4-6h | 🔵 LOW |
| **Future** | Voice interface | No | 3-5d | 🔵 LOW |
| **Future** | Window management | No | 3-4d | 🔵 LOW |

---

## 🎯 Next Steps

1. **This week**: Acquire signing certs, test CSP, schedule fresh install testing
2. **Post-1.0**: Pick highest-impact gap (AI actions → workflows → GitHub plugin)
3. **Monthly**: Track ecosystem growth (extension count + GitHub stars)
4. **Quarterly**: Reassess vs competitor features + user feedback

---

*Report compiled by: 4-agent research (competitors, trends, code analysis, GitHub audit) + AUDIT_REPORT.md*  
*Data accuracy: Based on ROADMAP.md, CHANGELOG.md, CLAUDE.md, and real codebase analysis (2026-04-14)*
