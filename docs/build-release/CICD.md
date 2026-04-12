# CI/CD Pipeline

This project uses [GitHub Actions](https://github.com/features/actions) for Continuous Integration and Continuous Deployment.

## Workflows

### 1. Check & Build (`check.yml`)

Triggered on:

- `push` to `main` branch
- `pull_request` targeting `main` branch

**Jobs:**

- **Setup**: Installs Bun and Rust environments.
- **Dependencies**: Installs Linux dependencies required for Tauri.
- **Linting**:
  - Checks code formatting with **Prettier**.
  - Lints code with **ESLint**.
- **Build**:
  - Builds the frontend to ensure type safety (`tsc`).
  - Compiles the Tauri backend (`cargo build`) to catch Rust compilation errors.

### 2. Release (`release.yml`)

Triggered on:

- Pushing a tag starting with `v` (e.g., `v1.0.0`).

**Jobs:**

- **Matrix Build**: Compiles the application for:
  - Windows (`windows-latest`)
  - macOS Silicon (`aarch64-apple-darwin`)
  - macOS Intel (`x86_64-apple-darwin`)
  - Linux (`ubuntu-22.04`)
- **Release**: Automatically creates a GitHub Release and uploads the generated installers/executables.

## How to Release

1. Ensure your local `main` branch is up to date and clean.
2. Create a new tag:
   ```bash
   git tag v0.1.0
   ```
3. Push the tag to GitHub:
   ```bash
   git push origin v0.1.0
   ```
4. Watch the "Actions" tab in your GitHub repository. Once complete, a new draft release will be available (or published, depending on config) with the artifacts attached.
