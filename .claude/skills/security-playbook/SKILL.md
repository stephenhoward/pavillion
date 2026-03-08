---
name: Security Playbook
description: Pavillion-specific security standards. Use this skill when implementing or reviewing security-sensitive features including authentication, file uploads, federation, public APIs, or template rendering.
---

# Security Playbook

This skill provides Claude Code with security standards specific to the Pavillion codebase. Use it when working on security-sensitive code or reviewing code for vulnerabilities.

## When to Use

Activate this skill when working on code that touches any of these areas:

- **Authentication & authorization** -- login flows, JWT handling, password reset, permission checks
- **API endpoints** -- new route handlers, input validation, error responses, rate limiting
- **File uploads** -- media handling, MIME validation, storage paths, size limits
- **ActivityPub federation** -- inbox processing, HTTP signatures, SSRF prevention, actor verification
- **Vue templates** -- `v-html` usage, dynamic content rendering, user-provided data display
- **Email templates** -- Handlebars rendering, dynamic content injection
- **Database queries** -- raw queries, `Sequelize.literal()`, mass assignment, Op injection
- **Configuration & secrets** -- environment variables, dev-only features, CSP/CORS headers

## Quick Reference

| Companion File | Covers |
|----------------|--------|
| [./express-request-handling.md](./express-request-handling.md) | Trust proxy, body size limits, UUID validation, query param types, error info leakage |
| [./database-injection.md](./database-injection.md) | `Sequelize.literal()`, raw queries, mass assignment, Op injection |
| [./authentication.md](./authentication.md) | JWT algorithm/expiration, password hashing, reset codes, IDOR, account enumeration |
| [./activitypub-federation.md](./activitypub-federation.md) | HTTP signatures, SSRF, actor/signer match, replay attacks, blocked instances |
| [./file-uploads.md](./file-uploads.md) | MIME validation, Multer limits, filename sanitization, path traversal, nosniff headers |
| [./public-api.md](./public-api.md) | Rate limiting, info disclosure, pagination limits, search sanitization, CORS |
| [./template-injection.md](./template-injection.md) | `v-html` with user data, Handlebars triple-brace, translation key injection |
| [./configuration.md](./configuration.md) | Secrets management, dev-only features in production, CSP/CORS headers |

## Instructions

The companion files in this skill directory contain the detailed standards for each topic. Read only the ones relevant to your current task.

Each standard file is organized into three sections:

1. **Threats** -- what can go wrong and how it could be exploited
2. **Safe Patterns** -- code examples that correctly prevent the threat
3. **Vulnerable Patterns** -- code examples that are exploitable, with explanations

Read only the standards relevant to your current task, then apply the safe patterns and avoid the vulnerable ones.

## Cross-References

For entity-model separation patterns referenced in database-injection.md, see the `backend-entity-model` skill. For service layer patterns, see the `backend-domain-structure` skill. For error serialization patterns, see the `backend-error-serialization` skill.

## Integration with Agents

This skill is the shared knowledge base for two specialized security agents:

- **security-advisor** -- runs at the **spec phase**, before code is written. Reviews spec documents for design-level security gaps like missing auth requirements, undefined trust boundaries, and unspecified rate limits.
- **security-auditor** -- runs at the **code phase**, after implementation. Reviews git diff changes for implementation vulnerabilities like SQL injection, auth bypass, SSRF, and XSS.

Both agents read from this skill's companion files. This skill gives you direct access to those same standards when implementing features, so you can follow the safe patterns from the start.
