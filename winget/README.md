# WinGet Manifest for Volt

This directory contains the WinGet package manifest for [Volt](https://github.com/VoltLaunchr/Volt), following the [winget-pkgs](https://github.com/microsoft/winget-pkgs) repository structure.

## Manifest Location

```
manifests/v/VoltLaunchr/Volt/0.0.4/
├── VoltLaunchr.Volt.yaml                  # Version manifest
├── VoltLaunchr.Volt.installer.yaml        # Installer manifest
└── VoltLaunchr.Volt.locale.en-US.yaml    # Default locale manifest
```

## Before Submitting: Compute the SHA256 Hash

The installer manifest contains a placeholder `TODO_SHA256_HASH` that must be replaced with the real SHA256 hash of the installer binary before submission.

**Step 1 — Download the installer:**

```powershell
Invoke-WebRequest -Uri "https://github.com/VoltLaunchr/Volt/releases/download/v0.0.4/volt_0.0.4_x64-setup.exe" -OutFile "volt_0.0.4_x64-setup.exe"
```

**Step 2 — Compute the hash:**

```powershell
(Get-FileHash -Algorithm SHA256 "volt_0.0.4_x64-setup.exe").Hash
```

**Step 3 — Update the manifest:**

Replace `TODO_SHA256_HASH` in `VoltLaunchr.Volt.installer.yaml` with the uppercase hex string output from Step 2.

Alternatively, use the [WinGet Create](https://github.com/microsoft/winget-create) tool to automate this:

```powershell
wingetcreate update VoltLaunchr.Volt --version 0.0.4 --urls "https://github.com/VoltLaunchr/Volt/releases/download/v0.0.4/volt_0.0.4_x64-setup.exe"
```

## Validating the Manifest

Install the WinGet CLI validation tool and run:

```powershell
winget validate --manifest manifests/v/VoltLaunchr/Volt/0.0.4/
```

Or use the [YAMLlint](https://yamllint.readthedocs.io/) and the official JSON schemas referenced at the top of each manifest file.

## Submitting to winget-pkgs

1. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) on GitHub.
2. Copy the `manifests/v/VoltLaunchr/Volt/0.0.4/` directory into the same path in your fork.
3. Open a pull request against `microsoft/winget-pkgs` with the title:
   ```
   New package: VoltLaunchr.Volt version 0.0.4
   ```
4. The automated validation pipeline (Azure Pipelines) will validate the manifest. Address any failures before the PR can be merged.
5. Once merged, `winget install VoltLaunchr.Volt` will work for all Windows users.

## Updating for Future Releases

For each new release, create a new versioned directory:

```
manifests/v/VoltLaunchr/Volt/<new-version>/
```

Copy the previous version's manifests, update `PackageVersion` in all three files, update the `InstallerUrl` and `InstallerSha256`, and update `ReleaseNotesUrl`. Then submit a PR titled:

```
Update VoltLaunchr.Volt to version <new-version>
```

The [winget-create](https://github.com/microsoft/winget-create) tool can automate most of this process.
