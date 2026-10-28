# Security Policy

## Reporting a vulnerability

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/Flow-Tube/flow-sync/security/advisories/new). Don't open a public issue, and don't include keys, tokens, recovery words or personal data in a report.

Include the affected version or commit, the component (specification, reference library, server, or a deployment template), reproduction steps, impact, and any known mitigations.

## What to expect

- Acknowledgment within 7 days.
- A fix or a coordinated disclosure plan within 90 days, or within 7 days if the issue is being exploited.
- Credit in the advisory, unless you prefer otherwise.

## Scope

In scope: the FLOW-SYNC/2 specification and its cryptography, the reference library, the server, the published container images, and the deployment templates in this repository.

Out of scope: instances run by third parties (there is no official instance), and weaknesses of a hosting platform itself. The security model and its stated limits are in [spec/threat-model.md](spec/threat-model.md).

Only the latest release and the default branch receive security fixes.
