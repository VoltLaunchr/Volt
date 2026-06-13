# Pilier C — Encrypted Data-at-Rest (SQLCipher) + OS Credential Manager Hardening

> **Status:** Feature-flagged integration (flag `sqlcipher`, **off by default**).
> **Scope:** Local-first data security best practices for Volt. Clipboard history, notes and
> extension KV are wired through the feature-aware database opener. Default builds remain
> plaintext; SQLCipher builds migrate existing stores on first open.

This document describes an industry-standard approach to encrypting sensitive data at rest in a
local-first desktop application. It is framed entirely around defensive best practices for
protecting **our own users' data** on **their own machines**. Nothing here concerns any third
party's software.

---

## 1. Threat model

Volt is a single-user desktop launcher. Its persistent stores live in the OS per-user app-data
directory. The relevant local-first threats, in increasing order of attacker capability:

| # | Threat | Description | In scope? |
|---|--------|-------------|-----------|
| T1 | **Stolen / lost disk** | Laptop stolen, disk imaged, drive sold without wiping, cloud backup of the app-data folder leaks. Attacker reads raw `.db` files offline. | **Yes — primary** |
| T2 | **Other user on a shared machine** | A different OS account (or an admin) browses another user's profile directory and opens the plaintext SQLite files. | **Yes** |
| T3 | **Casual file-level tampering** | A script or poorly-isolated process edits a state file on disk to escalate its own privileges. | Partially (already covered by HMAC-signed state files; see §6) |
| T4 | **Full malware with the user's session** | Code running *as the user* with the user's keyring access. It can do anything the app can. | **Out of scope** — no local-first mechanism defends against this; it is a different tier requiring OS-level EDR/sandboxing. We document the limit honestly rather than over-promise. |

**Design consequence.** Encryption-at-rest with a key held in the OS keyring fully addresses
T1 and T2: an offline attacker holding only the disk image cannot read the data, because the
key never lives on disk in plaintext — it lives in the OS-protected secret store
(DPAPI / Keychain / Secret Service), keyed to the logged-in user. It does **not** defend
against T4, and we should not claim it does.

This mirrors the standard advice for local-first apps (e.g. password managers, note apps,
browsers' "encrypted" stores): encrypt the database, store the key in the platform secret
store, and accept that a fully compromised user session is unrecoverable.

---

## 2. Current data layer inventory

Mapped from the codebase. "Sensitivity" reflects how damaging plaintext disclosure under T1/T2
would be.

### SQLite datastores (`rusqlite`, currently `bundled`, plaintext)

| Store | Location | Holds | Sensitivity | Decision |
|-------|----------|-------|-------------|----------|
| **Clipboard history** | `clipboard_manager/plugin.rs` → `clipboard_history` table | Full clipboard contents: copied passwords, tokens, 2FA codes, private messages, card numbers | **HIGH** | **ENCRYPT** |
| **Notes** | `commands/notes.rs` → `notes.db` (`notes`, `note_chunks`) | User free-text notes + embedding chunks; can contain anything private | **HIGH** | **ENCRYPT** |
| **Extension KV storage** | `commands/extensions.rs` → `storage.db` (`kv`) per extension | Arbitrary extension-persisted values; may hold API responses, user data | **MEDIUM** | **ENCRYPT** (Phase 2) |
| **File index** | `indexer/database.rs` → `files` table | File **paths + names + metadata** (no file contents) | **LOW–MEDIUM** | **SKIP initially** (see rationale) |

### JSON datastores (plaintext files)

| Store | Location | Holds | Sensitivity | Decision |
|-------|----------|-------|-------------|----------|
| **Snippets** | `commands/snippets.rs` → `snippets.json` | User text snippets; may contain templates with secrets | **MEDIUM** | Out of SQLCipher scope (not SQLite). Candidate for a future JSON-at-rest pass. |
| **Quicklinks** | `commands/quicklinks.rs` → `quicklinks.json` | URLs / folders / commands | LOW | Skip |
| **Launch history** | `launcher/history.rs` → `launch_history.json` | App names + launch counts | LOW | Skip |
| **Shell history** | `commands/shell_history.rs` → `shell_history.json` | Shell commands typed by the user — *can* contain secrets (`export TOKEN=…`) | **MEDIUM** | Out of SQLCipher scope (not SQLite). Note for future. |

### Already-protected secrets (no change needed)

| Store | Mechanism |
|-------|-----------|
| OAuth tokens (github, notion), Supabase session, saved credentials | **OS keyring** via `commands/keyring_store.rs` + `credentials.rs`, with domain-tagged **HMAC-SHA256** integrity tags (`store_signed` / `retrieve_signed`). Already best-practice. |
| Extension state (`installed.json`, `dev-extensions.json`) | Detached **HMAC-SHA256** `.sig` files, key in keyring (`utils/extension_state_sig.rs`). |

### Rationale for SKIP decisions

- **File index** — contains only paths/names/metadata of files the user already owns and can
  see in their own file explorer. Disclosure value under T1/T2 is low (it reveals *which* files
  exist, not their contents). It is also the **largest, hottest** DB (full-disk scan, WAL, live
  watcher), so it is the worst place to pay SQLCipher's per-page crypto cost first. Revisit only
  if we later index file *contents* or snippets of them.
- **JSON stores** — SQLCipher is a SQLite-only technology and cannot encrypt `.json` files. The
  medium-sensitivity ones (snippets, shell history) are flagged for a **separate** future track
  (either migrate them into an encrypted SQLite store, or add an AES-GCM file wrapper keyed from
  the same keyring-held key). Out of scope for Pilier C.

**Phase 1 encrypt target: clipboard history + notes.** **Phase 2: extension KV.**

---

## 3. Approach: SQLCipher via `rusqlite`

### 3.1 Exact feature flags (verified)

From the official rusqlite README and `libsqlite3-sys/README.md`, verified against
the `rusqlite 0.40.1` dependency used by Volt:

| Feature | Behavior |
|---------|----------|
| `sqlcipher` | Link against a **system-installed** SQLCipher shared library instead of SQLite. Requires SQLCipher present on the build/runtime host. |
| `bundled-sqlcipher` | Compile & link a **bundled** SQLCipher. Still needs a **system crypto library** (OpenSSL) to link against. |
| `bundled-sqlcipher-vendored-openssl` | Bundled SQLCipher **+ vendored OpenSSL** via `openssl-sys`. No system OpenSSL required. Implies `bundled-sqlcipher`. **Best choice for Windows CI** (no OpenSSL install dance). |

### 3.2 Conflict with the current `bundled` feature

`libsqlite3-sys` links **exactly one** SQLite/SQLCipher amalgamation. You cannot have both
`bundled` (plain SQLite) and `bundled-sqlcipher` active in the same build — the latter replaces
the former. Therefore the Cargo wiring must be **mutually exclusive**:

- **Default build:** `rusqlite` with `bundled` (today's behavior, unchanged).
- **`sqlcipher` feature build:** `rusqlite` with `bundled-sqlcipher-vendored-openssl` **instead of**
  `bundled`.

Cargo cannot "remove" a feature that is already requested elsewhere, so the cleanest pattern is:
keep `rusqlite` declared **without** `bundled` as a hard dependency, and add **both** the plain
`bundled` and the SQLCipher flavor behind Volt-level features that the default feature turns on.
See §7 for the exact `Cargo.toml` shape used by the feature-gated implementation.

### 3.3 Windows build caveats

- `bundled-sqlcipher-vendored-openssl` pulls `openssl-src`, which **compiles OpenSSL from
  source**. On Windows this needs Perl (Strawberry Perl) and a C toolchain (MSVC). CI runners
  (`windows-latest`) have these, but a clean dev box may not — hence the flag stays **off by
  default** so the everyday `cargo check`/`cargo build` never pulls this toolchain.
- First clean build with the flag on is noticeably slower (OpenSSL compile).
- Document the prerequisite in the PR that *enables* the flag, not before.

---

## 4. Key management

Reuse the existing keyring abstraction (`commands/keyring_store.rs`). Do **not** invent a new
secret store.

### 4.1 Key lifecycle

1. **Generation (first run per database):** a 32-byte cryptographically-random key is generated
   and hex-encoded.
2. **Storage:** stored in the OS keyring under
   `com.volt.launcher` / account `sqlcipher_db_key:<path-hash>`, via
   `keyring_store::store`.
3. **Retrieval:** every DB open reads the key from the keyring. The key **never** touches disk
   in plaintext and **never** crosses the IPC boundary into the renderer.
4. **Isolation:** each database has its own key. Losing one entry cannot orphan the other stores.
5. **Loss semantics:** if a key is missing for an existing encrypted/unreadable DB, Volt refuses
   to generate a replacement and returns a recovery error.
6. **Migration marker:** a separate path-scoped keyring marker records successful encryption.
   Once present, a plaintext file at that path is rejected as a downgrade/replacement attempt.

### 4.2 PRAGMA key flow (the crypto handshake)

SQLCipher activates encryption via a `PRAGMA key` issued **immediately after open, before any
other statement**:

```rust
// Open the connection (SQLCipher build).
let conn = Connection::open(path)?;

// Provide the raw key. Using the "x'<hex>'" raw-key form skips SQLCipher's
// PBKDF2 key-derivation step — appropriate because our key is already a
// full-entropy 32-byte random value, not a human passphrase.
conn.pragma_update(None, "key", format!("x'{hex_key}'"))?;

// (Optional) tune: cipher_page_size, kdf_iter, etc. Defaults are safe.
// Only AFTER the key is set may we run WAL / schema PRAGMAs and migrations.
conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;")?;

// Sanity probe: this fails fast with "file is not a database" if the key is
// wrong (or the file is plaintext), which is how we detect a needed migration.
conn.query_row("SELECT count(*) FROM sqlite_master", [], |_| Ok(()))?;
```

Key points:
- `PRAGMA key` must be the **first** operation. WAL mode and `foreign_keys` PRAGMAs come
  **after**.
- Use the **raw key** form `x'…'` (64 hex chars for 32 bytes) so SQLCipher uses the bytes
  directly. Passphrase form would run PBKDF2 over our already-random key — pointless cost.
- The `sqlite_master` probe is the canonical "is the key correct / is this DB encrypted?"
  check.

---

## 5. Migration plan (plaintext → encrypted), idempotent

We must upgrade an existing **plaintext** `.db` to an **encrypted** one without data loss, and
the operation must be safe to run on every startup (idempotent).

### 5.1 Algorithm (`sqlcipher_export`)

SQLCipher ships the `sqlcipher_export()` SQL function which copies a fully-attached database to
another attached database, applying the destination's cipher settings.

```
On open(path, key):
  1. If <path> does NOT exist:
       open encrypted, set PRAGMA key, create schema. Done (fresh install).

  2. If <path> exists:
       a. open with PRAGMA key; probe `SELECT count(*) FROM sqlite_master`.
          - probe OK  -> already encrypted with our key. Done (idempotent: the
                          common case on every subsequent launch).
          - probe ERR -> test a plaintext open. If readable, proceed to migrate;
                         otherwise return a recovery error (wrong/missing key).

       b. Migrate plaintext -> encrypted:
          - open plaintext <path> (no key);
          - ATTACH DATABASE '<path>.encrypted.tmp' AS encrypted KEY "x'<hex>'";
          - SELECT sqlcipher_export('encrypted');
          - DETACH DATABASE encrypted;
          - close both;
          - atomically rename: <path> -> <path>.plaintext.bak  (rollback artifact),
                               <path>.enc -> <path>;
          - reopen <path> with PRAGMA key; verify probe OK.
          - on success, remove the plaintext backup. On failure before the swap,
            leave the original untouched; on installation/verification failure,
            restore it through checked rollback. In both cases, return an error.
```

### 5.2 Idempotency & recovery

- Re-running on an already-encrypted DB short-circuits at step 2a (probe OK) — no work, no risk.
- A crash mid-migration leaves either the original `<path>` (rename not yet done) or
  `<path>.plaintext.bak` + new `<path>` (rename done). Both are recoverable; we never overwrite the
  source in place.
- With the SQLCipher feature enabled, a migration, key verification or recovery failure returns
  an error: the encrypted path is **fail-closed** and never opens the store as plaintext. The
  plaintext backup is only a temporary rollback artifact, not a runtime fallback connection.

---

## 6. Relationship to existing OS-keyring hardening

The keyring layer already provides the OS-native secret backend used by Volt. Pilier C
**extends** rather than replaces it:

- The DB encryption key is **just another keyring entry**, protected by the same DPAPI/Keychain/
  Secret Service backend already in use for tokens.
- SQLCipher keys deliberately use direct `store`/`retrieve`, not the shared HMAC wrapper. A lost,
  rotated or temporarily unavailable HMAC key must never cause deletion of an otherwise valid
  database key; SQLCipher authenticates the candidate key when opening the database.
- This unifies "secrets in keyring, bulk data in encrypted SQLite, key bridging the two" — the
  textbook layered model.

---

## 7. Rollout: Cargo feature flag `sqlcipher` (off by default)

`Cargo.toml` shape (mutually-exclusive bundling, default unchanged):

```toml
# rusqlite WITHOUT a bundling feature here; bundling is selected by a Volt feature.
rusqlite = { version = "0.40.1" }

[features]
# Default keeps plain bundled SQLite — today's behavior, no new build deps.
default = ["bundled-sqlite"]
bundled-sqlite = ["rusqlite/bundled"]

# Opt-in encrypted-at-rest. Replaces plain SQLite with bundled SQLCipher +
# vendored OpenSSL (no system OpenSSL needed). NOT in `default`: keeps the
# everyday build free of the OpenSSL/Perl toolchain requirement until validated.
sqlcipher = ["rusqlite/bundled-sqlcipher-vendored-openssl"]
```

- `cargo check` / `cargo build` (default) → plain `bundled` SQLite, identical to today.
- `cargo check --features sqlcipher` → SQLCipher flavor. **Do not** combine with the default
  `bundled-sqlite` in the same invocation (they conflict at the `libsqlite3-sys` link step); for
  a clean SQLCipher build use `--no-default-features --features sqlcipher`.

The flag remains off by default. Enabling it activates encryption and one-shot migration for the
wired sensitive stores; the default build keeps today's plaintext SQLite behavior.

---

## 8. Integration points

When ready to actually encrypt a store, swap the open call:

```rust
// clipboard_manager/plugin.rs, commands/notes.rs, etc.
//
// Today:
let conn = Connection::open(db_path)?;
//
// Current feature-aware helper from core::encrypted_db:
let conn = crate::core::encrypted_db::open_db(db_path)?;
// ^ with `sqlcipher` ON: provisions/reads the keyring key, runs PRAGMA key,
//   migrates plaintext->encrypted once, returns the encrypted connection.
//   with `sqlcipher` OFF: plain Connection::open, byte-for-byte today's path.
```

The following stores are wired: clipboard history, notes, and extension KV. The file index remains
plaintext by design. Before swapping files, migration checkpoints WAL, obtains exclusive access,
removes plaintext `-wal`/`-shm` sidecars, verifies the encrypted copy, and performs checked rollback
on failure.

---

## 9. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Build complexity (OpenSSL on Windows)** | Medium | `vendored-openssl` removes the system-OpenSSL dependency; CI runners already have Perl+MSVC. Flag off by default until a green CI run on all 3 OSes proves it. |
| **Performance** | Low–Medium | SQLCipher adds per-page AES. Negligible for clipboard/notes (small, low-QPS). Explicitly *why* the file index is excluded (hot path). Benchmark before/after on clipboard if concerned. |
| **Key loss = data loss** | High (inherent) | Refuse replacement-key generation for an opaque existing DB and return a recovery error. Optional: offer a user-initiated encrypted export/backup. |
| **Backup implications** | Medium | Once encrypted, a copied `.db` is useless without the keyring key — users backing up the app-data folder must understand restoring to a new machine won't recover encrypted stores. Surface in docs/settings. |
| **Migration corruption** | Medium | Same-directory atomic rename + temporary `.plaintext.bak` + `sqlite_master` probe; checked rollback on failure, backup removal only after verification, and no plaintext runtime fallback. |
| **Mixed-flavor binary mistake** | Low | Compile-time mutual exclusivity in `Cargo.toml`; CI builds both flavors. |

---

## 10. Deliverables in this pillar

1. **This blueprint.**
2. **Feature-gated implementation (flag off by default):**
   - `Cargo.toml`: `sqlcipher` feature wired to `rusqlite/bundled-sqlcipher-vendored-openssl`,
     default keeps `bundled`.
   - `src-tauri/src/core/encrypted_db.rs`: `open_db(path)` feature-aware helper +
     `open_encrypted(path, key)` (cfg-gated). `open_plain` is the compile-time path only when the
     SQLCipher feature is off; SQLCipher-enabled opens do not fall back to plaintext.
   - Per-database key provisioning in the OS keyring, independent of the shared HMAC key.
   - Idempotent plaintext migration with verified WAL checkpoint, inter-process lock,
     same-directory swap, rollback and persistent encrypted-state marker.
3. **Call sites wired:** clipboard history, notes, extension KV.

## 11. Decision record — 2026-06-12

- Legacy SQLCipher installations used the global `sqlcipher_db_key` account in
  Windows Credential Manager (DPAPI-backed). Volt now verifies that key against
  an existing encrypted database before copying it to the path-scoped account.
  It never generates a replacement for an opaque existing database.
- Integration fixtures cover plaintext-to-encrypted migration for clipboard,
  notes and extension KV, plus lost-key refusal and interrupted migration recovery.
- CI is configured to run the mutually-exclusive SQLCipher feature matrix explicitly on
  Windows, macOS and Linux. This replaces the invalid `--all-features` command,
  which combined plain bundled SQLite and bundled SQLCipher. The matrix is added,
  but its first GitHub run is still required before macOS/Linux validation is closed.
- **No `refinery` adoption now:** current schemas are small and intentionally
  domain-specific; explicit idempotent migrations remain easier to audit.
- **No generic repository layer now:** clipboard, notes and extension KV do not
  share enough behavior to justify an abstraction. Extract repositories only
  when concrete duplication appears.
- **No SQL frecency migration now:** launch history is small, the pushed-timestamp
  JSON model has no measured hot-path bottleneck, and moving it would add migration
  risk without user-visible benefit.

## 12. Security hardening — 2026-06-13

- `rusqlite 0.40.1` resolves `libsqlite3-sys 0.38.1`; its bundled SQLCipher amalgamation
  reports SQLCipher 4.14.0 and SQLite 3.51.3 at runtime. A regression test enforces both minima.
- Database keys no longer depend on credential HMAC verification. They remain in the OS
  keyring and are accepted only after SQLCipher successfully opens the target database.
- Plaintext migration now requires a complete `wal_checkpoint(TRUNCATE)`, verified DELETE
  journal mode, an exclusive SQLite lock and a separate cross-process file lock.
- A path-scoped keyring marker prevents an already-migrated store from being silently replaced
  by plaintext or restored from a stale plaintext migration backup.
- Windows validation: 317 SQLCipher tests and strict Clippy pass. The first GitHub matrix run
  on macOS/Linux remains required.
