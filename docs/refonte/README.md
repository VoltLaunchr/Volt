# Refonte — Core refactor (2026)

Active modernization of Volt's launcher core. This folder holds the **living**
tracking and the per-pillar blueprints. The original dated plan and the audits
that motivated the work are archived in [`../../archive/`](../../archive/).

| Doc | Status | What it covers |
|---|---|---|
| [`TODO-REFONTE.md`](./TODO-REFONTE.md) | 🟢 Living | Operational status of the 6 pillars (A–F); the source of truth for what's done / in progress / next |
| [`REFONTE-PILIER-C-SQLCIPHER.md`](./REFONTE-PILIER-C-SQLCIPHER.md) | Feature-flagged (`sqlcipher`, off by default) | Encrypted data-at-rest + OS credential hardening blueprint |
| [`REFONTE-PILIER-D-SEARCH.md`](./REFONTE-PILIER-D-SEARCH.md) | Blueprint + decision records | Next-gen file search (Tantivy full-text + Windows enumeration); D2/D3 USN track is NO-GO on data |
| [`REFONTE-REOUVERTURE-E2-D3-RAYCAST.md`](./REFONTE-REOUVERTURE-E2-D3-RAYCAST.md) | 🔁 Reopened 2026-10-14 (gated) | Raycast evidence for MSIX/uiAccess (E2/E3) and opt-in NTFS service (D2/D3); options, security, go/no-go gates |
| [`REFONTE-SEARCH-RANKING-UNIFIE.md`](./REFONTE-SEARCH-RANKING-UNIFIE.md) | ✅ Implemented 2026-10-14 | One tier ladder (generated from Rust) + lexicographic comparator for apps / plugin commands / files; universal frecency for plugin commands |
| [`INDEXATION-14C.md`](./INDEXATION-14C.md) | ✅ Implemented and locally tested 2026-10-14 | Hierarchical ignore rules, conservative generated-folder exclusions, opt-in local scan diagnostics |

Historical reference: [`archive/plans/REFONTE-2026.md`](../../archive/plans/REFONTE-2026.md)
(original plan, 2026-06-06) and [`archive/audits/AUDIT-2026.md`](../../archive/audits/AUDIT-2026.md).
