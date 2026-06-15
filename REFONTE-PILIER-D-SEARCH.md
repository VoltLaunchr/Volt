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

### 3.1 The idea

Instead of a recursive `readdir` walk (one syscall per entry), read the NTFS volume's
**Master File Table (MFT)** — the on-disk catalog of every file/dir on the volume —
in a single sequential pass, then subscribe to the **USN change journal** for deltas.
This is how instant-search utilities enumerate millions of files in seconds: the MFT
already *is* the directory of the whole volume.

- **MFT read** = full enumeration (replaces the cold `scan_files` walk on NTFS).
- **USN journal** = change feed (a faster, lower-overhead alternative/companion to
  the `notify` watcher for keeping the index current).

### 3.2 Crate status (verified June 2026)

- **`ntfs-reader` (latest `0.4.2`)** — fast in-memory scan of all `$MFT` records +
  a USN journal reader. API: open `Volume::new("\\\\.\\C:")`, build an `Mft`, iterate
  `FileInfo { name, path, is_directory, size, created/accessed/modified }`. Journal
  API via `JournalOptions` exposes `usn, timestamp, file_id, parent_id, reason, path`.
- **`usn-journal-rs`** — alternative; safe abstractions for the USN change journal +
  MFT enumeration on NTFS/ReFS.
- **`ntfs` (ColinFinck)** — lower-level no-std NTFS implementation (firmware → user
  mode); more work to wire up but maximally flexible.

Recommendation: **`ntfs-reader`** for the first cut — highest-level, gives both MFT
scan and USN reader in one crate.

Sources: [ntfs-reader on crates.io](https://crates.io/crates/ntfs-reader),
[ntfs-reader on lib.rs](https://lib.rs/crates/ntfs-reader),
[usn-journal-rs](https://github.com/wangfu91/usn-journal-rs),
[ColinFinck/ntfs](https://github.com/ColinFinck/ntfs).

### 3.3 Privilege requirement — documented honestly

Reading the raw MFT requires opening a **volume handle** (`\\.\C:`), which on Windows
requires **Administrator / elevated** privileges (it is effectively raw block-device
access). The USN journal generally also requires elevation. Volt today runs
**unelevated** (a launcher should not demand admin), so:

- **We never request elevation just for search.** Demanding UAC on every launch is
  hostile and a security smell.
- **Graceful fallback is mandatory.** The MFT path is attempted only when (a) the
  feature is on, (b) the target volume is **NTFS**, and (c) the process **is already
  elevated**. Otherwise we transparently fall back to the existing recursive
  `scan_files` walk. The runtime check (`is_elevated()` + NTFS filesystem probe)
  decides at scan time; the user sees faster indexing *if* they happen to run
  elevated, and identical behaviour otherwise.
- **Non-NTFS volumes** (FAT32/exFAT/network/ReFS-without-support) always use the
  fallback.

### 3.4 Cross-platform

MFT/USN is **Windows + NTFS only**. macOS and Linux **always** keep the current
recursive walk (and, on Windows, FAT/exFAT/network drives do too). Track 2 is purely
a Windows accelerator; it never becomes a cross-platform dependency. All `ntfs-reader`
usage is `#[cfg(windows)]` and behind its own feature so non-Windows builds never
compile it.

### 3.5 Integration sketch (phase 2)

```
scan (cold)
  └─ if cfg!(windows) && feature(mft-search) && is_elevated() && volume_is_ntfs(drive)
        → ntfs-reader MFT one-pass enumeration → FileInfo stream → SQLite + Tantivy
     else
        → existing scan_files recursive walk   (unchanged fallback)
incremental
  └─ if MFT path active → USN journal reader thread emits deltas → same upsert/remove sink
     else                → existing notify watcher (unchanged)
```

The output type is the **same `FileInfo` stream** the rest of the pipeline already
consumes, so SQLite + Tantivy + in-memory cache are all fed identically regardless of
which enumerator produced the data. This keeps Track 2 a drop-in *source*, not a
rewrite.

---

## 4. Phased rollout plan

| Phase | What | Flag | Default |
|---|---|---|---|
| 1 | Tantivy schema + persistent builder + exact/BM25/prefix/fuzzy query | `tantivy-search` | DONE, OFF |
| 2 | Wire scan, SQLite recovery, watcher sink and `search_files` routing | `tantivy-search` | DONE, OFF → measure |
| 3 | Promote Tantivy to default after validation on real hardware | — | ON (all OS) |
| 4 | MFT/USN enumerator (Windows, elevation-gated, fallback) | `mft-search` (new, phase 2) | OFF |
| 5 | Promote MFT to default on Windows after validation | — | ON (Windows/NTFS/elevated only) |

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
- The first local release build exceeded 20 minutes while linking the complete
  Tauri/ONNX crate, so no fabricated latency numbers are recorded here. Run the
  harness on a dedicated CI/performance runner before promotion.
- **D2/D3 decision: NO-GO for the current iteration.** Keep the tested recursive
  `read_dir` source on every OS. Re-open MFT/USN only if production telemetry or
  the release benchmark proves cold enumeration, rather than query latency, is
  the user-visible bottleneck.

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
| **MFT requires admin** | Runtime elevation + NTFS probe; transparent fallback to `scan_files`. Never request UAC for search. |
| **MFT Windows-only** | `#[cfg(windows)]` + own feature; macOS/Linux/non-NTFS always use the recursive walk. |
| **Behaviour drift while flag off** | Default path is the *unchanged* nucleo code; the feature only adds a `#[cfg]` branch, verified by `cargo check`/`clippy`/`test` with no features. |
| **`unsafe` Windows API in Track 2** | Deferred to phase 2; isolated in a single module via `ntfs-reader` (the crate encapsulates the unsafe), reviewed separately. |

---

## 7. Files in this deliverable

- `src-tauri/Cargo.toml` — new `tantivy-search` feature; `tantivy` as an optional dep
  enabled by it. Default build unchanged.
- `src-tauri/src/indexer/fulltext.rs` — **`#[cfg(feature = "tantivy-search")]`**
  production Tantivy schema, persistent build/query/upsert/remove implementation,
  with cfg-gated unit tests.
- `src-tauri/src/indexer/mft.rs` — **doc-only phase-2 stub** (no `unsafe`, no
  `ntfs-reader` dep yet) describing the MFT/USN accelerator and the elevation
  fallback contract.
- `src-tauri/src/indexer/mod.rs` — module wiring (both new modules cfg/doc-gated).
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
