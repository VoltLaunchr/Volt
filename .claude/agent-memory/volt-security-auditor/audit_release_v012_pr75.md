---
name: PR #75 release-readiness audit (v0.1.2)
description: 2026-05-03 audit of PR #75 — extension/shell/launcher surfaces verified ship-ready, no blockers
type: project
---

PR #75 (Release v0.1.2, dev branch HEAD 8267edc) audited end-to-end across the three highest-risk attacker surfaces. **Verdict: ship**, no blockers found.

**Why:** v0.1.2 hardening items (UWP regex gating, LOLBIN-before-split, signature fail-closed, perm allowlist) all confirmed wired correctly with test coverage. Streaming-path 50KB cap that was flagged in the prior `audit_shell_v2.md` audit is now landed (see `STREAM_OUTPUT_CAP` in `shell.rs:26`).

**How to apply:** Future audits of these surfaces can skip re-verifying the items in the PASS list — focus instead on:
1. The 4 minor issues noted (JSON-format injection in `increment_extension_download`, non-fail-closed `canonicalize` in `read_source_files_recursive`).
2. New surfaces added since this commit (devtools-on-by-default, shared capability across windows, sync re-validation — see `audit_release_readiness_2026-05-03.md`).
3. DNS rebinding remains an explicitly known limitation in `worker-sandbox.ts::isUrlSafe` — re-evaluate if/when a custom resolver layer becomes feasible.

PR #75 unrelated outstanding concerns from prior memory (devtools, multi-window capability sharing, sync.rs revalidation) are tracked separately in `audit_release_readiness_2026-05-03.md` — they were out-of-scope for this audit's three surfaces.
