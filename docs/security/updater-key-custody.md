# Updater signing-key custody

Volt's auto-updater is gated by a [minisign](https://jedisct1.github.io/minisign/)
signature pair issued by `tauri signer`. The public key is embedded in
`src-tauri/tauri.conf.json` (`updater.pubkey`). The private key signs every
release artifact and must be guarded as a high-value secret — anyone with
the private key can ship arbitrary code to every Volt user as a "legitimate
update."

This runbook describes where the key lives, how it is generated, how it is
used, how it is rotated, and what to do if it leaks. Fill in
`<placeholders>` with values that fit your operational setup; do not commit
them to the repository.

## 1. Custody

- **Owner**: `<single named release engineer + 1 backup>`. Do not let the
  list of holders grow without an explicit decision recorded in the
  release-engineering log.
- **Storage medium**: `<encrypted password manager / hardware token / offline
  USB stored in a safe>`. Never on a developer's day-to-day laptop without
  full-disk encryption + screen-lock policy.
- **Backup**: `<sealed envelope / second hardware token / encrypted backup>`,
  stored in a different physical location than the primary copy.
- **Access policy**: signing happens only on a trusted release machine, in a
  clean environment, after a release commit has been reviewed and tagged.
  CI does not autonomously sign releases.

The release engineer's password (`-p` to `tauri signer sign`) is stored
separately from the key file. A leaked key file alone does not allow
signing without the password; a leaked password alone is harmless without
the key.

## 2. Key generation

Generate a fresh keypair with `tauri signer`:

```bash
tauri signer generate -w ~/.tauri/volt.key
# enter a strong password when prompted; record it in the password manager
```

This produces:

- `~/.tauri/volt.key` — minisign secret key (passphrase-protected)
- `~/.tauri/volt.key.pub` — minisign public key (safe to publish)

The contents of `volt.key.pub` (base64-encoded) are what goes into
`tauri.conf.json` `updater.pubkey`.

## 3. Signing a release

```bash
tauri signer sign \
  -k ~/.tauri/volt.key \
  -p '<password>' \
  ./src-tauri/target/release/bundle/msi/Volt_<version>_x64_en-US.msi
```

Repeat for each platform's installer (`.msi`, `.dmg`, `.AppImage`, …). The
output `*.sig` files are uploaded alongside the binaries to the GitHub
release; `latest.json` references their URLs.

`tauri.conf.json` `updater.endpoints` points at the release's `latest.json`
on GitHub, and clients verify each downloaded artifact against the
embedded public key before installing.

## 4. Key rotation

Rotate the signing key on a fixed cadence (recommended: annually) and
immediately if the key is suspected to be compromised. Never reuse a
rotated key.

1. **Generate** a new keypair offline using §2's procedure. Store the new
   private key in the password manager / hardware token; do not delete the
   old key yet.
2. **Build** a new release signed with the new key (use the new key file
   for `tauri signer sign`).
3. **Update** `tauri.conf.json` `updater.pubkey` to the new public key. Push
   a release commit; this is the version that will become "current" for
   anyone updating from now forward.
4. **Publish** a transitional release containing _both_ signatures: every
   artifact has an `<artifact>.sig` from the old key and an
   `<artifact>.new.sig` from the new key. Shipped clients still trust the
   old key and install via `<artifact>.sig`; clients running the new
   `pubkey` install via `<artifact>.new.sig`. (Tauri's updater verifies a
   single sig per artifact, so the transitional period requires two
   parallel `latest.json` files served at different endpoints — one keyed
   on the old pubkey for legacy clients, one on the new for upgraded ones.)
5. **Sunset** the old key 30 days after the rotation release. By then most
   active installs have updated to the new pubkey; remaining laggards are
   asked to manually install the latest release via the website. Move the
   old private key to a "retired keys" archive; do not delete it (forensic
   evidence in case of dispute).

Document each rotation in the release-engineering log: date, reason,
old/new public key fingerprints, who performed the rotation.

## 5. Compromise response

If the private key is suspected to have leaked (laptop theft, password
manager breach, accidental commit, …) treat it as compromised and act
within 24 hours:

1. **Revoke** mentally — the key cannot be cryptographically revoked, so
   the only mitigation is rotating fast (§4).
2. **Notify** users via every channel you have (website banner, in-app
   warning if a fast emergency release can ship, GitHub Security Advisory,
   release notes). State clearly: "do not install updates between
   `<compromise window>`; download the next release manually from
   voltlaunchr.com."
3. **Forensic snapshot**: preserve disk images / password manager audit
   logs / shell history of the affected machine. Determine what other
   secrets sat next to the signing key (release SSH keys, GitHub tokens,
   Cloudflare API keys, ...) and rotate all of them.
4. **Issue a CVE / security advisory** describing the impact: any user who
   accepted an unauthenticated update during the compromise window MUST
   reinstall from a freshly-signed release. Provide checksums and
   alternate verification paths (GitHub release page, code signing
   certificates if any).
5. **Post-mortem** within one week: how the key leaked, what custody
   control failed, what hardening prevents recurrence. Update §1.

## 6. References

- Tauri updater plugin — Signing updates:
  <https://tauri.app/plugin/updater/#signing-updates>
- minisign reference: <https://jedisct1.github.io/minisign/>
- Threat model context: this runbook complements the 2026 security audit
  finding that pinned the updater public key but flagged custody as
  out-of-band; see audit Fix 5.
