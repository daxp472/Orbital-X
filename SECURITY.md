# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| v2.x.x (current) | ✅ Active support |
| v1.x.x | ❌ No longer supported |

## Reporting a Vulnerability

If you discover a security vulnerability in Orbital X, **please do not open a public GitHub issue**.

Instead, report it privately:

1. **Email:** `security@orbital-x.dev` *(or open a private GitHub Security Advisory)*
2. Include a description of the vulnerability, steps to reproduce, and potential impact.
3. We will acknowledge receipt within 48 hours and aim to issue a fix within 14 days.

## Security Model

Orbital X is designed with a defense-in-depth approach:

- **Path Isolation:** All file system operations validate that the resolved path remains within the opened workspace root. Directory traversal attacks (`../../`) are blocked at the Rust kernel boundary.
- **Policy Engine:** Tool calls are risk-rated and conditionally require user approval depending on the active agent mode (Agent Pro / Dev / User).
- **Credential Protection:** API keys are stored locally, masked in the UI, and are never transmitted except to the explicitly configured provider endpoint.
- **No Telemetry:** Orbital X does not phone home. All data stays on your machine.
- **WebView Isolation:** The frontend WebView cannot access native OS resources directly — all sensitive operations must go through the audited Rust IPC layer.
