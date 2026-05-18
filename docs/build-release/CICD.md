# CI/CD Pipeline

Volt uses [GitHub Actions](https://github.com/features/actions). All workflows live in [`.github/workflows/`](../../.github/workflows/).

## Workflow overview

| Workflow | File | Trigger | Purpose |
|---|---|---|---|
| **CI / Check & Build** | `check.yml` | push / PR on `main` and `dev` | Lint + type-check + build (3 platforms) + Rust clippy |
| **Release** | `release.yml` | tag matching `v*` | Matrix build → signed artifacts → GitHub Release |
| **Auto-tag** | `auto-tag.yml` | merge of branch matching `release/v*` into `main` | Creates the `vX.Y.Z` tag (which fires `release.yml`) |
| **Changelog** | `changelog.yml` | push / dispatch | Regenerates the docs changelog from commits |
| **End-to-end tests** | `e2e.yml` | push / PR | Playwright e2e suite |
| **PR title lint** | `pr-title.yml` | PR opened/edited | Enforces Conventional Commits style |
| **Version bump** | `version-bump.yml` | dispatch | Helper to align `package.json` / `Cargo.toml` / `tauri.conf.json` |

---

## 1. CI / Check & Build (`check.yml`)

Triggered on `push` / `pull_request` against **`main`** and **`dev`**.

**Matrix**: `ubuntu-latest`, `macos-latest`, `windows-latest` (`fail-fast: false`).

**Steps**:
1. Setup Bun (latest) and Rust stable with `rustfmt` + `clippy`.
2. Cache Rust dependencies via `Swatinem/rust-cache@v2` (scoped to `src-tauri`).
3. On Ubuntu, install Tauri's GTK/WebKit dependencies (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, …).
4. `bun install`.
5. **Version manifest check** (Ubuntu only): `bun run check-version` — ensures `package.json`, `Cargo.toml`, and `tauri.conf.json` are aligned.
6. Lint: `bun run lint` (ESLint 9, flat config — see [`CLAUDE.md`](../../CLAUDE.md) Lint section for non-negotiable rules).
7. Format check: `bun prettier --check .`
8. Type-check + bundle: `bun run build` (= `tsc && vite build`).
9. Rust check + clippy: `cargo check` + `cargo clippy -- -D warnings`.

Required env: `TAURI_SIGNING_PRIVATE_KEY` (for `tauri build` step — see [`SIGNING_SETUP.md`](./SIGNING_SETUP.md)).

---

## 2. Release (`release.yml`)

Triggered on push of any tag matching `v*` (e.g. `v0.2.0`). Tags are normally created by `auto-tag.yml` after a `release/vX.Y.Z` branch is merged — see the **Release Process** checklist in [`CLAUDE.md`](../../CLAUDE.md).

**Matrix build**:
- `windows-latest` → `.msi` + `.exe` (NSIS) + Tauri sig
- `macos-latest` (`aarch64-apple-darwin` + `x86_64-apple-darwin`) → `.dmg` + sig
- `ubuntu-22.04` → `.deb` + `.rpm` + `.AppImage` + sig

**Outputs**: a GitHub Release with all artifacts attached plus a `latest.json` manifest consumed by `tauri-plugin-updater` for in-app auto-update.

Required secrets:
- `TAURI_SIGNING_PRIVATE_KEY` — updater signing key (see [`security/updater-key-custody.md`](../security/updater-key-custody.md))
- Windows code-signing cert (`.pfx`/`.p12`) — see [`SIGNING_SETUP.md`](./SIGNING_SETUP.md)
- Apple Developer credentials for notarization (when enabled)

---

## 3. Auto-tag (`auto-tag.yml`)

Fires **only** when a branch named `release/v*` is merged into `main` (`startsWith(head_ref, 'release/v')`).

⚠️ This is why every release **must** be cut from `release/vX.Y.Z` branched off `origin/main`. A PR from `dev` or any other branch will *not* tag the release — the tag stays on the old commit and the new artifacts never publish. This was the root cause of the v0.1.7 broken release. See the **Release Process** in [`CLAUDE.md`](../../CLAUDE.md).

---

## 4. Other workflows

- **`changelog.yml`** — regenerates `docs/changelog/` content. Note: `scripts/generate-changelog.mjs` is known to drop entries after squash-merge, so the manual `public/changelog.json` entry remains the source of truth for in-app release notes.
- **`e2e.yml`** — runs `bun run test:e2e` (Playwright) headless. Part of the required check set for merges.
- **`pr-title.yml`** — enforces Conventional Commits via `commitlint`.
- **`version-bump.yml`** — manual `workflow_dispatch` to bump versions in all manifests at once.

---

## How to release

The full, bloc-by-bloc checklist (branch naming, version bump, changelog entry, local validation, **chunk-cycle scan**, smoke test, post-merge verification) lives in [`CLAUDE.md`](../../CLAUDE.md) under "Release Process". Condensed flow:

```bash
git fetch origin main && git checkout -b release/v0.2.1 origin/main
node scripts/bump-version.mjs 0.2.1
# Add public/changelog.json entry manually
bun run lint && bun run build && bun run test
cd src-tauri && cargo check && cargo clippy -- -D warnings && cd ..
node scripts/sync-version.mjs --check
# Cycle scan + WebView2 smoke test (see CLAUDE.md §3A/§3B)
git push -u origin release/v0.2.1
gh pr create --title "chore(release): v0.2.1" --body "..."
# Wait CI → merge → auto-tag → release artifacts → smoke-test the .msi
```

Never skip the chunk-cycle scan: it catches the class of bug that broke v0.1.8 (Rollup `manualChunks` cycle → `createContext` undefined → splash infini).
