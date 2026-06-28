# Archive

Point-in-time documents that are **no longer maintained**. They are kept for
historical context (what was audited, planned, or shipped at a given date) but
are **not** a source of truth for the current state of Volt. For that, see
[`docs/`](../docs/) and [`docs/refonte/TODO-REFONTE.md`](../docs/refonte/TODO-REFONTE.md).

_Reorganized: 2026-06-28._

## `audits/`
One-shot codebase / security audits, valid only as of their stated date.

| Doc | Date | Notes |
|---|---|---|
| [`AUDIT_REPORT.md`](./audits/AUDIT_REPORT.md) | 2026-04-14 | General codebase audit |
| [`AUDIT-2026.md`](./audits/AUDIT-2026.md) | 2026-05-30 | "Standards 2026" audit; fed the core refactor (see `docs/refonte/`) |
| [`FEATURES_GAP_ANALYSIS.md`](./audits/FEATURES_GAP_ANALYSIS.md) | 2026-04-14 | Self-declared historical gap analysis |
| [`RUST_CODE_REVIEW_2025.md`](./audits/RUST_CODE_REVIEW_2025.md) | 2025-05 | Full Rust review of `main` |

## `plans/`
Implementation / sprint plans that have been executed or superseded.

| Doc | Notes |
|---|---|
| [`REFONTE-2026.md`](./plans/REFONTE-2026.md) | Original dated 2026 refactor plan; live tracking moved to `docs/refonte/` |
| [`IMPLEMENTATION_PLAN.md`](./plans/IMPLEMENTATION_PLAN.md) | M0–M5 milestone journal (2025-12) |
| [`ACCESSIBILITY_AUDIT.md`](./plans/ACCESSIBILITY_AUDIT.md) | v1.0.1 accessibility sprint |
| [`ACCESSIBILITY_SETTINGS_PLAN.md`](./plans/ACCESSIBILITY_SETTINGS_PLAN.md) | Accessibility settings implementation plan |
| [`BUG_BASH_PLAN.md`](./plans/BUG_BASH_PLAN.md) | Pre-launch bug-bash plan (2026-06-13) |

## `reports/`
Frozen status reports.

| Doc | Notes |
|---|---|
| [`INTEGRATIONS_UI_SHOWCASE.md`](./reports/INTEGRATIONS_UI_SHOWCASE.md) | Integrations settings UI showcase (2026-04-14) |
| [`EXTENSION_INTEGRATION.md`](./reports/EXTENSION_INTEGRATION.md) | Extension integration status — "COMPLETE" (2026-04-14) |
| [`UPDATES_2025-01.md`](./reports/UPDATES_2025-01.md) | January 2025 updates summary |

## `superpowers/`
Executed design specs and step-by-step implementation plans
([`plans/`](./superpowers/plans/), [`specs/`](./superpowers/specs/)) for the
phase-2 quality polish, i18n, and web-worker-sandbox work.
