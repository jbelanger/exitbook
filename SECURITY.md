# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in exitbook, please **do not open a public GitHub issue**. Since this is a financial tool, responsible disclosure is important.

Report vulnerabilities via [GitHub private vulnerability reporting](https://github.com/jbelanger/exitbook/security/advisories/new).

Include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

You can expect an acknowledgement within 48 hours and a resolution timeline within 7 days for critical issues.

## Scope

In scope:

- Data integrity issues (incorrect calculations, silent data loss)
- Credential or API key exposure
- Dependency vulnerabilities with a clear exploit path
- SQL injection or similar injection attacks

Out of scope:

- Issues requiring physical access to the machine
- Social engineering
- Vulnerabilities in dependencies with no practical exploit path

## Supported Versions

Only the latest release is actively maintained.

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |
| older   | No        |
