# Accepted Risks Register

Vulnerabilities reported by automated scanners that have been triaged and
accepted (with rationale + mitigation) rather than patched. Each entry must
be revisited when a Tauri / gtk-rs / underlying-crate release lands.

---

## glib 0.18.5 — `VariantStrIter` Iterator unsoundness

- **Severity:** Medium
- **GHSA:** Dependabot alert #1 (`glib`, RUSTSEC range `>= 0.15.0, < 0.20.0`)
- **Patched in:** glib 0.20.0
- **Platform impact:** Linux only (transitive via the gtk-rs stack)
- **Dependency chain:**
  `glib 0.18.5 ← atk 0.18.2 ← gtk 0.18.2 ← muda 0.19.1 ← tauri 2.11.x`
- **Status:** Accepted, blocked upstream

### Why we cannot patch directly

`glib 0.20` is a breaking change for the entire gtk-rs ecosystem. Bumping it
requires `gtk-rs/atk-rs/etc.` to also be at 0.20, which is in turn pinned by
`muda` (the menu/tray-icon crate Tauri 2.x uses on Linux). `muda` has not yet
released a version that adopts the gtk-rs 0.20 series. A local
`[patch.crates-io]` override is not viable because the API surface differs
across the 0.18 → 0.20 transition and would require forking the entire
gtk-rs cohort.

### Why the runtime impact is acceptable

The unsoundness is in `Iterator::next` and `DoubleEndedIterator::next_back`
impls for `glib::VariantStrIter`. Triggering it requires:

1. Constructing a `glib::Variant` of type `as` (array of strings)
2. Iterating it
3. The variant data being malformed in a specific way that the iterator's
   length calculation does not catch

Volt does **not** construct or consume `glib::Variant` values anywhere in
its codebase. The only `glib` usage is what `gtk` / `webkit2gtk` do
internally for IPC between Volt's webview and the gtk-rs runtime — none of
which exposes `VariantStrIter` to attacker-controlled inputs.

### Revisit checklist

- [ ] Tauri ships a release that upgrades muda → gtk-rs 0.20
- [ ] If a Volt code path is added that touches `glib::Variant` directly,
      reclassify this risk immediately
- [ ] If glib upstream backports the fix to 0.18, switch to a `[patch]`
      override

---

## Updating this register

When dismissing a Dependabot alert in the GitHub UI, add a corresponding
entry here. The "Status" line must reflect one of:

- **Accepted, blocked upstream** — fix exists but cannot be applied without
  a parent-crate / parent-package release
- **Accepted, unreachable code** — vuln is in a code path we don't exercise
- **Mitigated** — fix not applied but compensating control documented

Anything else gets fixed, not registered.
