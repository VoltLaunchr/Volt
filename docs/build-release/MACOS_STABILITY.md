# macOS stability without local Mac hardware

Volt can build and partially validate macOS releases without a local Mac by using GitHub Actions macOS runners. This is enough to catch packaging, compile, signing-shape, and basic launch regressions. It is not enough to claim full user-level stability without at least one real-device beta pass.

## Current free gate

The release workflow runs `scripts/macos-smoke.sh` after each macOS Tauri build.

It verifies:

- exactly one `.app` bundle is produced;
- `Info.plist` exists and uses `CFBundleIdentifier=volt.launch`;
- the app executable exists and is executable;
- `codesign --verify --deep --strict` passes;
- exactly one `.dmg` is produced;
- `hdiutil verify` accepts the DMG;
- the DMG mounts and contains an `.app`;
- the app launches on the runner when the artifact architecture matches the runner architecture.

When `APPLE_CERTIFICATE` is not configured, Gatekeeper assessment is reported as a warning because ad-hoc signing is expected to fail `spctl`.

When `APPLE_CERTIFICATE` is configured, the smoke test becomes stricter:

- the app must be signed by a `Developer ID Application` authority;
- `spctl -a -vvv -t execute` must accept the app.
- `xcrun stapler validate` must accept the DMG notarization ticket.

## What still requires Apple Developer

These items cannot be completed for free:

- Developer ID Application certificate;
- notarization through Apple;
- Gatekeeper-clean first launch for normal users;
- a public "stable macOS" claim.

Until those are available, release notes and download pages should say that macOS builds are beta-quality and may require manual Gatekeeper override.

## Minimum beta checklist

Ask testers to record the macOS version, CPU architecture, and whether the build is signed/notarized.

Required scenarios:

- download the DMG from the draft release;
- open the DMG and drag Volt to Applications;
- launch Volt from Applications;
- dismiss or report any Gatekeeper warning;
- trigger the global hotkey;
- scan applications and search for Safari, Terminal, System Settings, and one third-party app;
- launch at least two applications from Volt;
- search files in a small test folder;
- open Settings, change theme, quit, and reopen;
- collect `~/Library/Logs/volt/volt.log` or the app data log path if a crash or hang occurs.

Exit criteria before calling macOS stable:

- release CI is green for both macOS targets;
- the smoke test passes with `APPLE_CERTIFICATE_CONFIGURED=true`;
- at least one Apple Silicon tester completes the checklist;
- at least one Intel tester completes the checklist, or Intel support is explicitly marked beta/unsupported;
- no open P0/P1 macOS issue remains without a documented workaround.
