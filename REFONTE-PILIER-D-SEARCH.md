# Pilier D — Next-Gen File Search Blueprint

> **Scope.** This document is the implementation blueprint for Volt's next-generation
> local file search. It covers two complementary tracks: a **full-text / relevance
> index (Tantivy)** and a **fast filesystem enumeration accelerator on Windows
> (NTFS MFT / USN journal)**. It is framed entirely as industry-standard
> best-practice for building fast local search; no third-party binary internals
> are discussed.
>
> **Status.** Track 1 is feature-complete behind the `tantivy-search` Cargo feature
> (OFF by default). A dedicated Criterion CI workflow is present, but its first
> GitHub run is still required. Track 2 remains a documented NO-GO for this iteration.

---

## 0. TL;DR — Recommendation

1. **Adopt Tantivy first (Track 1), behind a feature flag.** It is the single
   highest-leverage change: it removes the current full in-memory `Vec<FileInfo>`
   linear scan, adds true relevance ranking (exact/BM25/prefix/fuzzy), and filters
   hidden entries inside the index before top-k collection. It is feature-gated,
   keeps the default build unchanged, and
   coexists cleanly with the existing SQLite store (SQLite stays the source of
   truth; Tantivy becomes the query engine).

2. **Treat the NTFS MFT/USN accelerator (Track 2) as a later, optional, Windows-only
   phase.** It is the standard technique behind "instant" file finders: instead of
   walking the directory tree with `readdir`, you read the volume's Master File
   Table in one pass and subscribe to the USN change journal for deltas. The catch
   is privilege: opening a raw volume handle requires Administrator. We therefore
   gate it behind both a feature flag **and** a runtime elevation check, and we
   **always fall back** to the existing recursive `scan_files` walk when not
   elevated or not on NTFS.

3. **Keep `nucleo-matcher` as the default path.** The `tantivy-search` implementation
   is complete and validated behind its feature flag, while nucleo remains the
   default and fallback until real-hardware benchmarks justify promotion.

Phased rollout: **Track 1 (Tantivy, flagged) → measure → default-on → Track 2 (MFT,
flagged + elevation-gated, Windows-only) → measure → default-on (Windows)**.

---

## 1. Current architecture (as-is)

Read directly from the codebase. Key files:

| File | Role |
|---|---|
| `src-tauri/src/indexer/scanner.rs` | Recursive `readdir` walk (`scan_files` → `scan_directory`), `max_depth` 3 (shallow) or 10 (deep). Builds `Vec<FileInfo>`. |
| `src-tauri/src/indexer/database.rs` | `FileIndexDb` — SQLite (WAL), `files` + `metadata`. Source of truth. Full scans replace the snapshot transactionally only after success. |
| `src-tauri/src/indexer/watcher.rs` | `notify` v6 recursive watcher, 100 ms debounce, incrementally synchronizes SQLite, the in-memory snapshot/lookup and Tantivy. `stop()` joins the worker. |
| `src-tauri/src/indexer/search_engine.rs` | `SearchEngine` — `nucleo-matcher` fuzzy scoring over the **entire in-memory Vec**, with category/recency/frequency boosts and operator filters. |
| `src-tauri/src/indexer/windows_search.rs` | Windows Search Index supplement via PowerShell + OLE DB (`Search.CollatorDSO`). Used to top up sparse results. |
| `src-tauri/src/indexer/fulltext.rs` | Feature-gated persistent Tantivy index: exact boosts, BM25, prefix, fuzzy transpositions, hidden filtering, batch updates and schema recovery. |
| `src-tauri/src/commands/files.rs` | Tauri commands. `FileIndexState` holds the snapshot, path lookup, SQLite and optional Tantivy state. Startup reuses Tantivy only when dirty marker and document count agree. |

### Data flow today

```
start_indexing
  └─ if DB non-empty & !force → load all rows into Arc<Vec<FileInfo>>  (fast path)
     else → spawn_blocking(scan_files) → upsert_files(SQLite) + set Arc<Vec>
search_files (per keystroke, debounced 150 ms FE)
  └─ Arc::clone(cache) → SearchEngine::search → nucleo score every file → sort → truncate
     └─ (Windows) if sparse, top up via windows_search PowerShell query
watcher (notify)
  └─ debounce 100 ms → upsert/remove SQLite + snapshot/lookup + Tantivy batch
```

### Performance ceiling (the problem)

- **Search is O(N) per query.** `SearchEngine::search` iterates the **whole**
  `Vec<FileInfo>` and runs nucleo on every entry, on **every keystroke**. At
  tens of thousands of files this is fine (the bench searches 5 000 in <1 s); at
  hundreds of thousands → millions it becomes the bottleneck. There is no
  inverted index — there is no way to look at only the candidate documents.
- **The whole index lives in RAM as `Vec<FileInfo>`.** Each `FileInfo` carries
  `name`, `path`, `extension`, plus an optional icon string. Memory grows linearly
  with file count; a multi-million-file index is impractical to hold fully resident.
- **Sorting re-derives everything per query.** Recency/frequency boosts are
  recomputed for every candidate every time; there are no precomputed sortable
  ("fast") fields.
- **Enumeration is a recursive `readdir` walk.** Even with the OneDrive-hydration
  and canonicalisation optimisations already in `scanner.rs`, a cold full-drive
  scan is inherently slow because it issues one syscall per directory entry. This
  is the cost Track 2 (MFT) eliminates.

The current design is a solid baseline for "index my Documents/Desktop/Downloads".
Pilier D is about scaling to "index the whole drive, instantly".

---

## 2. Track 1 — Full-text / relevance index with Tantivy

### 2.1 Crate status (verified June 2026)

- **`tantivy` latest: `0.26.0`** (docs.rs shows 0.26.0 as latest; 0.25.0 was the
  prior release). Pure-Rust, Apache-2.0, the engine that powers Quickwit.
- **Builds on stable Rust, Linux/macOS/Windows.** Tantivy explicitly supports
  Windows; no C/C++ toolchain required (unlike Lucene/Elastic).
- **Edition 2024, MSRV ~1.86** for the 0.26.x line — compatible with this repo
  (`edition = "2024"` in `Cargo.toml`).
- We pin **`tantivy = { version = "0.26", optional = true }`** behind the feature.

Sources: [tantivy on crates.io](https://crates.io/crates/tantivy),
[tantivy 0.26.0 docs.rs](https://docs.rs/crate/tantivy/latest),
[tantivy releases](https://github.com/quickwit-oss/tantivy/releases).

### 2.2 Why Tantivy over the current nucleo scan

| Dimension | Current (nucleo over Vec) | Tantivy |
|---|---|---|
| Query complexity | O(N) every keystroke | O(matching docs) via inverted index |
| Ranking | fuzzy score + ad-hoc boosts | exact-name boost + BM25 + weighted prefix/fuzzy clauses |
| Prefix / "as-you-type" | implicit via fuzzy | zero-distance prefix query on normalized `name_exact`/`name` terms |
| Filtering | applied around the linear matcher | `hidden` filtered inside Tantivy before top-k collection |
| Memory | full `Vec<FileInfo>` resident | mmap'd segments, OS page cache |
| Scale | tens of thousands comfortably | millions |
| Typo tolerance | nucleo fuzzy | `FuzzyTermQuery` (Levenshtein) |

We **keep nucleo** for the small/default case and for highlighting; Tantivy is the
engine for large indexes. They are not mutually exclusive — see §2.7 routing.

### 2.3 Schema design

A document per file. Fields:

| Field | Type | Options | Purpose |
|---|---|---|---|
| `name` | `text` + `STORED` | simple tokenizer + lowercase + ASCII folding | BM25 and token-level prefix/fuzzy relevance |
| `name_exact` | `text` | raw tokenizer + lowercase + ASCII folding | exact whole-name boost and whole-name prefix matching |
| `path` | `STRING` + `STORED` | exact, not tokenized | unique key, returned to UI, used for dedup/delete |
| `ext` | `text` | raw tokenizer; value/query normalized ASCII lowercase | `ext:pdf` operator |
| `category` | `STRING` | indexed | category filter |
| `size` | `u64` | `FAST` | size metadata/filtering |
| `mtime` | `i64` (Unix secs) | `FAST` | modification-time metadata/filtering |
| `hidden` | `bool` | `INDEXED` + `FAST` | exclude hidden files before top-k collection |

**Tokenizers**

- `name` uses `SimpleTokenizer` + lowercase + ASCII folding for BM25 terms.
- `name_exact` uses `RawTokenizer` + lowercase + ASCII folding for normalized
  whole-name exact and prefix queries.
- `path` and `category` use Tantivy `STRING` fields. `ext` uses a raw-token field with
  explicit ASCII lowercase normalization at indexing and query time.

**Fast fields** are limited to `size`, `mtime` and `hidden`; `hidden` is also indexed
so exclusion happens inside the Tantivy query before top-k collection.

### 2.4 Index storage location & size

- Location: `<app_data_dir>/file_history.tantivy` (derived from the existing
  `file_history.db` path). Created lazily on first feature-on run.
- On-disk bytes/document are reported by the Criterion harness. The dedicated CI
  workflow has been added; its first run is still required before recording a baseline.
- Segments are memory-mapped; resident RAM is governed by the OS page cache, not by
  the total index size — this is the key win over the all-resident `Vec`.

### 2.5 Building the index

Two build paths, both reuse the **existing** `scan_files` / SQLite pipeline — we do
**not** add a second filesystem walk:

1. **Cold build from SQLite.** After `scan_files` upserts into `FileIndexDb`, a new
   `build_from_files(&[FileInfo])` (in `indexer::fulltext`) streams the same
   `Vec<FileInfo>` into a Tantivy `IndexWriter` (single commit, ~50 MB heap writer).
   This piggybacks on the work already done; no extra disk walk.
2. **Warm load.** On startup, if the Tantivy dir exists and is non-corrupt, just
   open it (mmap) — no rebuild.

### 2.6 Incremental updates from the `notify` watcher

The watcher already produces upsert/remove batches in `flush_events`. We add a
parallel sink: when the feature is on, every batch is also applied to the Tantivy
writer:

- **Upsert** = `delete_term(path) + add_document(...)` then a **periodic** commit
  (Tantivy commits are not free; batch them on the same 100 ms debounce, or every
  N docs, whichever comes first).
- **Remove** = `delete_term(path)` + commit on the debounce.
Implemented: the watcher marks Tantivy dirty before mutation, applies successful
SQLite changes as a Tantivy batch, then marks the derived index clean. On shutdown,
the notify handle is dropped and the worker thread is joined before a rebuild begins.

### 2.7 Query routing (how search uses the index)

A thin trait boundary decouples the engine from the command layer:

```rust
// indexer/fulltext.rs (feature-gated) implements this; the nucleo engine is the
// default impl. The command layer talks to the trait, not the concrete engine.
pub trait FileQueryBackend {
    fn query(&self, query: &str, opts: &FileQueryOptions) -> Result<Vec<FileHit>, String>;
}
```

- **Default build (`tantivy-search` off):** `search_files` behaves **exactly** as
  today — `Arc::clone(cache)` + `SearchEngine` (nucleo). No trait indirection on the
  hot path; the integration point is a documented `#[cfg]` branch, not a rewrite.
- **Feature on:** `search_files` routes to the Tantivy backend. Query construction:
  1. Build a `BooleanQuery`: boosted exact/prefix clauses on `name_exact` plus BM25
     and weighted prefix/fuzzy clauses on tokenized `name`,
     optionally **AND** filter clauses (`ext`, `category`, `parent_dir`, `size`
     range, `mtime` range) derived from the same operators already parsed today.
  2. Optionally add a `FuzzyTermQuery` on `name` for typo tolerance.
  3. Collect top-K via `TopDocs` by Tantivy relevance score, then map stored
     `path`/`name` back to `FileHit`.
- **Windows Search supplement** stays as-is and is orthogonal to the backend choice.

### 2.8 Result quality / latency vs nucleo

- **Quality:** exact-name boosts, BM25, normalized prefix clauses and weighted
  `FuzzyTermQuery` clauses provide layered relevance; hidden files are excluded
  before top-k collection.
- **Latency:** the inverted index changes the query shape from a full linear scan
  to matching-document collection. No p50/p99 claim is recorded until the first
  dedicated CI benchmark run completes.
- **Trade-off:** Tantivy commit latency on writes (mitigated by debounced batching)
  and on-disk index size (mitigated by capped ngram length).

---

## 3. Track 2 — Fast filesystem enumeration on Windows (NTFS MFT / USN)

> **Phase 2. Documented only — no code in this deliverable beyond a doc stub.**
> This is the standard best-practice technique for "instant" local file enumeration.

### 3.1 The idea — and the privilege correction (June 2026)

The original framing assumed "fast NTFS enumeration ⇒ read the raw MFT ⇒ requires
Administrator". The second implication is **false in general** and led the plan astray.
Spotlight-/Everything-style "instant" search does **not** make every user run elevated:
the OS maintains an index and apps query it. There are in fact **two** NTFS fast-paths
with **different** privilege levels, and they must be kept separate:

| Mechanism | Win32 surface | Privilege | Role |
|---|---|---|---|
| **Raw `$MFT` bulk read** | `CreateFile(\\.\C:, GENERIC_READ)` | **Administrator** (raw block-device access) | Optional accelerator, *only if already elevated*. Never required. |
| **USN change journal read** | `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` on a handle opened with `FILE_TRAVERSE` | **None** (standard user) | The no-admin live-delta feed we actually ship. |

So the corrected design is:

- **Baseline enumeration, no admin** = the **Windows Search Index** (already wired in
  `indexer/windows_search.rs` via OLE DB `Search.CollatorDSO`) + the existing recursive
  `scan_files` walk for folders outside the index scope.
- **Live deltas, no admin** = the **unprivileged USN journal** reader (`indexer/usn.rs`).
- **Raw `$MFT` bulk read** = downgraded to an *opportunistic, admin-only* accelerator —
  attempted only when the process is already elevated, never prompting UAC, with a
  byte-for-byte identical fallback otherwise.

The USN journal only reports **changes** since the journal was created — it is a delta
feed, never a substitute for the baseline enumeration. That is why the no-admin design
pairs it with Windows Search (+ recursive walk fallback).

### 3.2 Crate status (verified June 2026)

- **`ntfs-reader` (latest `0.4.2`)** and **`usn-journal-rs`** — both open the volume in
  **read** mode (`Volume::new("\\\\.\\C:")`), i.e. the **admin** path, and neither
  clearly exposes `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`. They are therefore only useful
  for the *optional admin-only* raw-MFT accelerator, **not** for the no-admin USN feed.
- **`ntfs` (ColinFinck)** — lower-level no-std NTFS implementation; for the future
  admin-only raw-MFT path only.

Recommendation: the **no-admin USN reader uses a thin in-tree FFI layer**
(`indexer/usn.rs`) — open the volume with `FILE_TRAVERSE`, `DeviceIoControl` with
`FSCTL_QUERY_USN_JOURNAL` then `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`, walk
`USN_RECORD_V2/V3`. No third-party NTFS crate is required for this path. The raw-MFT
accelerator, if ever built, would use `ntfs-reader` behind `is_elevated()`.

Sources: [ntfs-reader on crates.io](https://crates.io/crates/ntfs-reader),
[ntfs-reader on lib.rs](https://lib.rs/crates/ntfs-reader),
[usn-journal-rs](https://github.com/wangfu91/usn-journal-rs),
[ColinFinck/ntfs](https://github.com/ColinFinck/ntfs).

### 3.3 Privilege requirement — corrected

Two different operations, two different privilege levels — do not conflate them:

- **Raw `$MFT` bulk read** opens `CreateFile(\\.\C:, GENERIC_READ)`, which *is*
  effectively raw block-device access and **does require Administrator**. This is the
  part that is now **optional and opportunistic only**.
- **USN journal read** can be done **without any elevation** via
  `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` issued on a volume handle opened with the
  minimal `FILE_TRAVERSE` access right (not `GENERIC_READ`). This is documented on
  Microsoft Learn and is exactly how non-admin change-journal consumers work.

Volt runs **unelevated** by design, so:

- **We never request elevation just for search.** No code path prompts UAC.
- **No-admin is the default.** The shipped fast path = Windows Search Index (baseline)
  + unprivileged USN (deltas). Requires no special privileges; it is the only path
  wired into the lifecycle.
- **Raw MFT is opportunistic.** Attempted only when the process **is already elevated**
  AND the volume is **NTFS** AND `mft-search` is on; otherwise a silent fallback to the
  baseline path with identical behaviour.
- **Non-NTFS volumes** (FAT32/exFAT/network) have no USN journal → baseline path only.

### 3.4 Cross-platform

MFT/USN is **Windows + NTFS only**. macOS and Linux **always** keep the current
recursive walk (and, on Windows, FAT/exFAT/network drives do too). Track 2 is purely
a Windows accelerator; it never becomes a cross-platform dependency. All `ntfs-reader`
usage is `#[cfg(windows)]` and behind its own feature so non-Windows builds never
compile it.

### 3.5 Integration sketch

```
scan (cold)  — no admin
  └─ Windows Search Index query (indexer/windows_search.rs)   [baseline, instant]
     + scan_files recursive walk for folders outside the index scope
     (optional, admin-only) if cfg!(windows) && feature(mft-search) && is_elevated() && NTFS
        → raw $MFT one-pass enumeration → FileInfo stream      [accelerator, never required]

incremental  — no admin
  └─ if cfg!(windows) && feature(usn-incremental) && volume has a USN journal
        → indexer/usn.rs: FSCTL_READ_UNPRIVILEGED_USN_JOURNAL loop
          → reason flags mapped to upsert/remove → SAME sink as the watcher
     else → existing notify watcher (unchanged)
```

The output type is the **same `FileInfo` stream / upsert-remove batches** the rest of
the pipeline already consumes (`db.upsert_file` / `db.remove_file` + `fulltext.apply_batch`
+ in-memory cache), so every enumerator feeds the index identically. Track 2 is a
drop-in *source*, not a rewrite. The USN reader persists its resume cursor
`(UsnJournalID, NextUsn)`; a changed journal id (wrap/recreate) triggers a baseline
rebuild rather than a silent gap.

### 3.6 Empirical validation (run unelevated on a real NTFS volume, 2026-06-16)

A diagnostic probe (`src-tauri/examples/usn_probe.rs`) exercised the path end-to-end
as a **standard user (no UAC)**:

- **Opening + draining works with zero privilege.** `CreateFile(\\.\C:, FILE_TRAVERSE)`
  + `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` drained **300k+ records at ~1M rec/s**.
- **The unprivileged read STRIPS inline filenames.** Every record returns as a
  64-byte header (`RecordLength=64`, `FileNameLength=0`) with FRN/parent-FRN/USN/
  reason/attributes/timestamp but **no name** — not even for a marker file we
  created ourselves. (Confirmed at the raw-byte level; it is a security property of
  the unprivileged variant, not a parser bug.) The USN gap between records (~128 B)
  vs the 64-byte buffer entry is the tell: the on-disk record *has* a name; the
  unprivileged read does not hand it over.
- **`OpenFileById(FRN)` resolves the full path with no elevation.**
  `OpenFileById` + `GetFinalPathNameByHandleW` resolved **~73% of changed FRNs**
  (e.g. `C:\Users\…\AppData\Local\Google\Chrome\…\History`); the remaining ~27% are
  inaccessible system files or already-deleted ids → correctly skipped. This also
  yields the **full path** (not just a name), so it solves parent-FRN reconstruction
  outright.

**Consequence for the design:** the inline-name path is a dead end without admin.
The no-admin pipeline is: USN journal = *which FRNs changed + how*; `resolve_path`
= *FRN → full path* for upserts; an `FRN → path` map (seeded from the baseline) =
resolution for deletes (whose FRN no longer opens). All three steps are unprivileged.
`StartUsn` must be `0`, `FirstUsn`, or a previously-returned USN — an arbitrary offset
yields `ERROR_INVALID_PARAMETER` (87), so resume always uses a journal-issued cursor.

---

## 4. Phased rollout plan

| Phase | What | Flag | Default |
|---|---|---|---|
| 1 | Tantivy schema + persistent builder + exact/BM25/prefix/fuzzy query | `tantivy-search` | DONE, OFF |
| 2 | Wire scan, SQLite recovery, watcher sink and `search_files` routing | `tantivy-search` | DONE, OFF → measure |
| 3 | Promote Tantivy to default after validation on real hardware | — | ON (all OS) |
| 4 | **Unprivileged USN delta reader** (Windows, no admin, fallback to notify) | `usn-incremental` (new) | OFF |
| 5 | Promote unprivileged USN to default on Windows/NTFS after validation | — | ON (Windows/NTFS) |
| 6 | *Optional* raw-MFT bulk accelerator, admin-only & opportunistic | `mft-search` (deferred) | OFF |

Each promotion is gated on: cold-build time, query p50/p99, index size, and a
correctness diff against the nucleo baseline on a fixed corpus.

### Decision record — 2026-06-12

- D1 is feature-complete: persistent index, exact/BM25/prefix/fuzzy ranking,
  transpositions, ASCII folding, hidden filtering, watcher synchronization and
  startup consistency checks.
- Criterion now compares nucleo and Tantivy at 1k/10k documents, checks a fixed
  relevance corpus and reports on-disk bytes/document. The dedicated
  `.github/workflows/search-benchmark.yml` workflow is added, but its first GitHub
  run is still required.
### Decision record — 2026-06-16 (first local bench run)

The Criterion harness was run locally (`cargo bench --features tantivy-search`).
Median query latency, `filename_only`, top-20:

| corpus | query | nucleo | Tantivy |
|---|---|---|---|
| 1 000 | visual code | **0.29 ms** | 8.15 ms |
| 1 000 | firefx (fuzzy) | **0.27 ms** | 7.31 ms |
| 1 000 | quarter report | **0.19 ms** | 6.87 ms |
| 10 000 | visual code | **2.63 ms** | 7.77 ms |
| 10 000 | firefx (fuzzy) | **1.23 ms** | 2.01 ms |
| 10 000 | resume reunion | **1.49 ms** | 3.53 ms |
| 10 000 | quarter report | **1.29 ms** | 1.95 ms |

Tantivy on-disk: **65 B/doc** at 1k, **53 B/doc** at 10k (≈0.5 MB for 10k).

**Reading the numbers:**

- **nucleo (linear scan) is faster than Tantivy across *every* query up to 10k docs.**
  Tantivy carries a fixed per-query overhead (~2–8 ms) that dominates at these sizes;
  nucleo grows ~linearly with N (visual code: 0.29 ms→2.63 ms, ~10×) while Tantivy
  stays flatter. The crossover where Tantivy wins is **beyond 10k docs** — i.e. only
  for *large* corpora.
- **A large corpus is exactly what D2/D3 (fast enumeration) produces.** So D1 (Tantivy)
  and D2/D3 (enumeration) are a *package*: Tantivy only earns its keep once enumeration
  has indexed tens of thousands of files; below that, nucleo is the better default.
- **Caveat — the harness measures the wrong axis for the D2/D3 gate.** It times *query
  latency*, not *cold enumeration wall-time*, which is the thing MFT/USN actually
  improves. A proper D2/D3 gate needs an **enumeration benchmark** (`scan_files` walk vs
  unprivileged USN drain) on a real NTFS volume. That is the missing measurement.

**Decisions:**

- **Tantivy stays OFF by default.** These numbers do not justify promoting it; nucleo
  wins at the corpus sizes most users actually have.
- **D2/D3 lifecycle wiring: still NO-GO** until an *enumeration* benchmark proves cold
  enumeration is the user-visible bottleneck.
- **But the hard no-admin primitive is now in-tree and reviewed:** the unprivileged USN
  reader landed behind `usn-incremental` (`indexer/usn.rs`, pure parser unit-tested,
  FFI isolated). Wiring it to the index sink + an `FRN→path` map is the next step, to be
  taken only after the enumeration benchmark GO.

### Decision record — 2026-06-24 (enumeration benchmark — the missing measurement)

The enumeration benchmark called for above was built (`examples/enum_bench.rs`, behind
`usn-incremental`) and run locally on a real NTFS volume, **unprivileged**, against the
full user profile `C:\Users\Noluc`.

| Strategy | Items | Wall time | Throughput |
|---|---:|---:|---:|
| Directory walk (`scan_files`, cold) | 2 128 042 | 5 000.9 s (~83 min) | 426 files/s |
| USN drain (records 0→tip) | 327 873 | 148 ms | 2.21 M rec/s |
| USN resolve sample (FRN→path) | 31 342 / 40 000 | 18.5 s | **462 µs/file** |

- USN reads are **nameless** (0 / 327 873): the unprivileged journal strips inline
  filenames, so each record needs an `OpenFileById` + `GetFinalPathNameByHandleW`
  resolution (78.4 % succeed; the rest are system/deleted → skipped).
- Projected resolve-only cost for the full delta set: 327 873 × 462 µs ≈ **117 s**.

**Reading the numbers (with the methodology note, see below):**

- **The naive "walk vs USN drain" is apples-to-oranges and must not drive the decision.**
  The walk produces a *full point-in-time enumeration* (2.1 M files); the USN drain returns
  only *recent deltas* (328 k changes). USN "wins" 5000 s → 148 ms only because it does far
  less work. The valid comparison is **(baseline walk once + USN deltas forever)** vs
  **(re-walk on every refresh)** — USN amortizes *re-scanning*, it never removes the baseline.
- **No unprivileged "instant baseline enumeration" exists for us.** The Everything-style
  instant full enumeration reads the raw **MFT**, which needs admin — and we abandoned that
  (D2). Unprivileged USN gives only the *live-delta* half of that design, never the
  *fast-baseline* half. **The baseline therefore must remain a directory walk.**
- **Per-file resolution is the load-bearing cost.** 462 µs/file means turning a USN change
  into an indexed path costs an `OpenFileById` syscall each — raw drain throughput
  (2.2 M rec/s) is misleading. At a realistic change volume this can approach the cost of a
  *targeted re-walk* of the changed subtrees.
- **The 83-min full-profile walk is an upper-bound artifact, not the user-facing number.**
  It includes `AppData`, dev caches (`.cargo`, `.rustup`, `node_modules`), and cloud
  placeholders — none of which a launcher should index. The real target is the user's
  configured work folders (~50–200 k files), which is the number still to be measured.

**Decisions:**

- **D3 lifecycle wiring: NO-GO for this iteration** — confirmed, now on data not assumption.
  The decision rests on three gates; only the first is met:
  1. ✅ Cold baseline *is* a user-visible cost.
  2. ❌ Re-scan frequency that would justify USN's complexity is **unmeasured** (no telemetry).
  3. ❌ USN-delta path (incl. 462 µs/file resolve) proven cheaper than a targeted re-walk on
     *observed* change volumes — **unproven**.
- **Cheaper wins come first** (Vague 3.2): background/incremental scan (walk off the hotkey
  path), debounced `notify` watcher doing *targeted* re-scans of changed dirs, and an
  index-age + lazy-refresh policy scoped to user folders (not the full profile). These likely
  dissolve the perceived cold-start cost without any per-record resolution syscalls.
- **The USN primitive stays in-tree, reviewed, OFF.** `indexer/usn.rs` (15 tests, FRN→path +
  delete-resolution map done) is sound and kept behind `usn-incremental`. Wiring is
  **blocked pending metrics**, not discarded. Revisit after telemetry on re-scan frequency
  and change volume, and after a target-folder (not full-profile) walk measurement.

> **Methodology note (research, 2026-06-24).** A separate fairness analysis grounds the above:
> USN journal is a bounded rotating delta log, not an enumeration; Everything uses MFT-first
> then USN-live; unprivileged USN cannot read the MFT; cold-cache cannot be forced without
> admin (report warm+cold pairs; beware OneDrive reparse hydration); and records/s is the
> wrong axis — measure records→resolved-paths/s. Sources: MS Learn (USN record `FileName` is a
> base name not a path; journal is bounded), voidtools forum (MFT-baseline + USN-live model),
> libUSNJournal (`FILE_TRAVERSE` + `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` = no admin).

---

## 5. Migration & coexistence

- **SQLite stays the source of truth.** It already persists across restarts and
  feeds the in-memory cache. Tantivy is *derived* from it and can always be rebuilt
  from SQLite (or from a fresh scan) — so a corrupt/missing Tantivy dir is a
  non-fatal "rebuild" event, never data loss.
- **`invalidate_index` ("Rebuild Index")** gains a feature-gated step: after clearing
  SQLite and rescanning, it also drops and rebuilds the Tantivy dir.
- **No schema change to `FileInfo` or the SQLite `files` table.** Tantivy reads from
  the same `FileInfo`. This keeps the diff small and the rollback trivial (delete the
  Tantivy dir, flip the flag off).
- **Frontend unchanged.** The `search_files` command signature and `FileSearchResult`
  shape (`#[serde(rename_all = "camelCase")]`) are preserved; only the backend that
  fills them changes.

---

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| **Tantivy index corruption** | Index is derived from SQLite; on open-error we log + rebuild from `get_all_files()`. Never fatal. |
| **Disk usage** | Measure bytes/document in the Criterion harness before promotion; no baseline is claimed before the first dedicated CI run. |
| **Write/commit latency** | Debounce commits on the existing 100 ms watcher window / N-doc batches; never commit per event. |
| **Build complexity / first compile cost** | tantivy is a heavy first build but pure-Rust, no C toolchain; gated behind a feature so default CI builds are unaffected. |
| **Conflating MFT with admin** | Keep raw-MFT (admin) and USN (no-admin) strictly separate. The shipped path is unprivileged USN; raw MFT is opportunistic only. Never request UAC for search. |
| **USN journal absent/disabled on a volume** | `FSCTL_QUERY_USN_JOURNAL` returns `ERROR_JOURNAL_NOT_ACTIVE`/`ERROR_INVALID_FUNCTION` → fall back to the `notify` watcher. Do not auto-create the journal (would need admin). |
| **USN journal wrap / recreate** | Persist `(UsnJournalID, NextUsn)`; on id mismatch or `ERROR_JOURNAL_ENTRY_DELETED`, trigger a baseline rebuild instead of silently missing changes. |
| **MFT/USN Windows-only** | `#[cfg(windows)]` + own feature; macOS/Linux/non-NTFS always use the recursive walk + notify. |
| **Behaviour drift while flag off** | Default path is the *unchanged* nucleo + notify code; the features only add `#[cfg]` branches, verified by `cargo check`/`clippy`/`test` with no features. |
| **`unsafe` Windows FFI in the USN reader** | Isolated in `indexer/usn.rs`; the record-walking parser is pure & unit-tested on synthetic buffers, so only the thin `DeviceIoControl` shell is `unsafe`. Reviewed separately. |

---

## 7. Files in this deliverable

- `src-tauri/Cargo.toml` — new `tantivy-search` feature; `tantivy` as an optional dep
  enabled by it. Default build unchanged.
- `src-tauri/src/indexer/fulltext.rs` — **`#[cfg(feature = "tantivy-search")]`**
  production Tantivy schema, persistent build/query/upsert/remove implementation,
  with cfg-gated unit tests.
- `src-tauri/src/indexer/mft.rs` — **doc-only** privilege map; documents the
  admin-only raw-MFT accelerator and points at the no-admin USN path.
- `src-tauri/src/indexer/usn.rs` — **`#[cfg(all(windows, feature = "usn-incremental"))]`**
  unprivileged USN change-journal reader (thin `DeviceIoControl` FFI + pure,
  unit-tested `USN_RECORD` parser). The no-admin live-delta source.
- `src-tauri/src/indexer/mod.rs` — module wiring (all new modules cfg/feature-gated).
- This blueprint.

---

## 8. References

- [tantivy — crates.io](https://crates.io/crates/tantivy) (latest 0.26.0)
- [tantivy 0.26.0 — docs.rs](https://docs.rs/crate/tantivy/latest)
- [tantivy releases — GitHub](https://github.com/quickwit-oss/tantivy/releases)
- [ntfs-reader — crates.io](https://crates.io/crates/ntfs-reader) (latest 0.4.2)
- [ntfs-reader — lib.rs](https://lib.rs/crates/ntfs-reader)
- [usn-journal-rs — GitHub](https://github.com/wangfu91/usn-journal-rs)
- [ColinFinck/ntfs — GitHub](https://github.com/ColinFinck/ntfs)
- [FSCTL_READ_USN_JOURNAL — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_read_usn_journal) (and the `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` variant: non-admin USN reads via a `FILE_TRAVERSE` handle)
- [Change Journal operations — Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/fileio/change-journal-operations)
