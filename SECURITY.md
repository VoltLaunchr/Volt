# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | Yes                |
| < Latest | No                |

Only the most recent release of Volt receives security updates. Users are strongly encouraged to keep their installation up to date.

## Reporting a Vulnerability

If you discover a security vulnerability in Volt, please report it responsibly. **Do not open a public GitHub issue.**

### How to Report

- **Email:** [security@voltlauncher.com](mailto:security@voltlauncher.com)
- **GitHub Security Advisories:** [Report via GitHub](https://github.com/VoltLaunchr/Volt/security/advisories/new)

### What to Include

- A clear description of the vulnerability and its potential impact.
- Steps to reproduce the issue, including any relevant configuration or environment details.
- Proof-of-concept code or screenshots, if available.
- Your suggested severity assessment (Critical, High, Medium, Low).

### What to Expect

| Stage                | Timeline       |
| -------------------- | -------------- |
| Acknowledgment       | Within 48 hours |
| Initial assessment   | Within 7 days  |
| Status update        | Every 14 days  |
| Fix or mitigation    | Best effort, typically within 90 days |

We will keep you informed throughout the process and coordinate on disclosure timing.

## Scope

### In Scope

The following categories of issues are considered valid security vulnerabilities:

- **IPC bypass** -- circumventing Tauri command permission boundaries or capability restrictions.
- **Extension sandbox escape** -- an extension breaking out of its Web Worker sandbox or bypassing granted permissions.
- **Privilege escalation** -- gaining elevated system privileges through Volt or its update mechanism.
- **Data exfiltration** -- unauthorized access to clipboard history, credentials, file index data, or other sensitive information managed by Volt.
- **Code injection** -- remote or local code execution via crafted search queries, extension manifests, plugin inputs, or deep links.
- **Authentication or authorization flaws** -- bypassing OAuth flows or accessing protected functionality without proper authorization.
- **Supply chain risks** -- compromised dependencies or build pipeline vulnerabilities.

### Out of Scope

The following are **not** considered security vulnerabilities:

- Social engineering attacks against users or maintainers.
- Denial of service on a local machine (Volt is a local desktop application).
- Attacks requiring physical access to the device.
- Issues in third-party dependencies that do not have a demonstrated impact on Volt.
- Bugs that require the user to have already granted full system permissions.
- Self-inflicted issues from running Volt with elevated privileges contrary to documentation.
- Vulnerabilities in community extensions hosted in the [volt-extensions](https://github.com/VoltLaunchr/volt-extensions) repository (report those in that repository directly).

## Coordinated Disclosure Policy

We follow a **90-day coordinated disclosure** process:

1. The reporter submits the vulnerability through one of the channels listed above.
2. We acknowledge receipt, investigate, and develop a fix.
3. Once a fix is ready, we coordinate a release date with the reporter.
4. The vulnerability is disclosed publicly no sooner than **90 days** after the initial report, or when the fix is released, whichever comes first.
5. If we are unable to address the issue within 90 days, we will negotiate an extended timeline with the reporter.

We ask that reporters refrain from public disclosure until the coordinated disclosure date.

## Recognition

We value the work of security researchers. With your permission, we will credit you in:

- The release notes for the version containing the fix.
- Our **Security Hall of Fame** (maintained in this repository).

If you would like to be credited under a specific name, handle, or organization, please let us know when submitting your report.

## Contact

For any questions about this policy, reach out to [security@voltlauncher.com](mailto:security@voltlauncher.com).
