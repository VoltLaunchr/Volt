# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest  | Yes       |
| < latest | No       |

Only the latest published release receives security patches. Update to the latest version before reporting.

## Reporting a vulnerability

**Do NOT open a public issue for security vulnerabilities.**

### Preferred: GitHub Security Advisory (private)

1. Go to [Security Advisories](https://github.com/VoltLaunchr/Volt/security/advisories/new)
2. Click **New draft security advisory**
3. Fill in the details and submit

This creates a private channel visible only to maintainers.

### Alternative: email

Send an email to **pro.voltlaunchr@outlook.com** with the subject line:

```
[SECURITY] Volt: <brief title>
```

### What to include

- Affected version(s) and OS
- Step-by-step reproduction instructions
- Impact assessment (what an attacker could achieve)
- Proposed fix or mitigation, if any
- Whether you want to be credited in the advisory

## Response timeline

| Stage | Target |
|-------|--------|
| Acknowledgment | 7 days |
| Triage and severity assessment | 14 days |
| Fix or mitigation (critical) | 30 days |
| Fix or mitigation (moderate/low) | 90 days |
| Public disclosure | After fix is released, or 90 days from acknowledgment (whichever comes first) |

## Coordinated disclosure

We follow a coordinated disclosure model. We ask reporters to keep the vulnerability confidential until a fix is available. We will credit reporters in the security advisory unless they request anonymity.

## Out of scope

- Vulnerabilities in upstream dependencies (report to the upstream project)
- Social engineering or phishing
- Physical access attacks
- Denial of service via resource exhaustion (unless trivially exploitable remotely)
- Issues in development/test tooling that don't affect end users
