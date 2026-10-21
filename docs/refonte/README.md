# Refonte — Core refactor (2026)

Active modernization of Volt's launcher core. This folder holds the **living**
tracking and the per-pillar blueprints. The original dated plan and the audits
that motivated the work are archived in [`../../archive/`](../../archive/).

| Doc | Status | What it covers |
|---|---|---|
| [`TODO-REFONTE.md`](./TODO-REFONTE.md) | 🟢 Living | Operational status of the 6 pillars (A–F); the source of truth for what's done / in progress / next |
| [`REFONTE-PILIER-C-SQLCIPHER.md`](./REFONTE-PILIER-C-SQLCIPHER.md) | Feature-flagged (`sqlcipher`, off by default) | Encrypted data-at-rest + OS credential hardening blueprint |
| [`REFONTE-PILIER-D-SEARCH.md`](./REFONTE-PILIER-D-SEARCH.md) | Blueprint + decision records | Next-gen file search (Tantivy full-text + Windows enumeration); D2/D3 USN track is NO-GO on data |

Historical reference: [`archive/plans/REFONTE-2026.md`](../../archive/plans/REFONTE-2026.md)
(original plan, 2026-06-06) and [`archive/audits/AUDIT-2026.md`](../../archive/audits/AUDIT-2026.md).
