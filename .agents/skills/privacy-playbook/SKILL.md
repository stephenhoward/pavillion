---
name: Privacy Playbook
description: Pavillion-specific privacy standards. Use this skill when implementing or reviewing features that handle personally identifiable information (PII) including logging, API responses, federation profiles, cookies, moderation workflows, email communications, and browser storage.
---

# Privacy Playbook

This skill provides Claude Code with privacy standards specific to the Pavillion codebase. Use it when working on code that could expose, store, share, or log personally identifiable information (PII).

Pavillion has a privacy-first mission (DEC-004): full anonymous access for public site visitors, accounts only for organizers/curators/admins. All calendars are public. This playbook enforces that mission at the code level.

## When to Use

Activate this skill when working on code that touches any of these areas:

- **Public API responses** -- data returned to unauthenticated visitors via `/api/public/`
- **Authenticated API responses** -- data returned to logged-in users via `/api/v1/`
- **Structured logging** -- Pino logger calls that might include PII (IPs, emails, account IDs, usernames)
- **ActivityPub federation** -- actor profiles, outbox events, inbox processing that share data with other instances
- **Frontend data exposure** -- API calls visible in browser DevTools, data in page source, browser storage
- **Database storage** -- PII retention, fields that could be pseudonymized, retention policies
- **Error responses** -- PII leaked in error messages sent to clients
- **Cookies and sessions** -- identifiers set for unauthenticated visitors
- **Email communications** -- PII in email bodies, headers, and metadata
- **Content moderation** -- reporter identity protection, IP data handling, admin visibility boundaries
- **Analytics and tracking** -- absence of tracking for public visitors (this is a feature, not a gap)

## Quick Reference

| Companion File | Covers |
|----------------|--------|
| [./logging.md](./logging.md) | Pino structured logging, IP addresses in logs, email/username/account ID logging, log redaction |
| [./api-responses.md](./api-responses.md) | Public vs authenticated API field exposure, `toObject()` in public endpoints, account ID leakage, minimal data principle |
| [./federation.md](./federation.md) | ActivityPub actor profiles, event author attribution, outbox content, PII shared with remote instances |
| [./frontend-exposure.md](./frontend-exposure.md) | Browser storage, API responses visible in DevTools, page source data, cookies for unauthenticated visitors |
| [./data-storage.md](./data-storage.md) | PII retention policies, pseudonymization, IP hashing, email hashing, data minimization in entities |
| [./error-responses.md](./error-responses.md) | PII in error messages, account existence disclosure, internal IDs in errors |
| [./email-communications.md](./email-communications.md) | PII in email bodies, headers, reply-to addresses, email template data |
| [./moderation-privacy.md](./moderation-privacy.md) | Reporter anonymity, IP data lifecycle, admin visibility boundaries, reporter-to-reported isolation |

## Instructions

The companion files in this skill directory contain the detailed standards for each topic. Read only the ones relevant to your current task.

Each standard file is organized into three sections:

1. **Privacy Risks** -- what PII could be exposed and to whom
2. **Safe Patterns** -- code examples that correctly minimize PII exposure
3. **Leaky Patterns** -- code examples that expose PII unnecessarily, with explanations

Read only the standards relevant to your current task, then apply the safe patterns and avoid the leaky ones.

## Key Principle: Three-Tier Visibility

Pavillion has three categories of users with different PII visibility levels:

1. **Public visitors** (unauthenticated) -- ZERO PII exposure. No cookies, no tracking, no account IDs in responses, no IP logging beyond rate limiting.
2. **Authenticated users** (organizers, editors) -- minimal PII: their own account data, collaborator display names (not emails), calendar membership info.
3. **Administrators** -- broader PII access for moderation and system health, but still with constraints (hashed IPs, not raw; hashed emails for reporters, not plaintext).

Every feature should be evaluated against this three-tier model.

## Cross-References

For security aspects of PII handling (injection, auth bypass), see the `security-playbook` skill. For API response structure conventions, see the `consistency-playbook` skill. For entity-model separation relevant to PII field selection, see the `backend-entity-model` skill.

## Integration with Agents

This skill is the shared knowledge base for two specialized privacy agents:

- **privacy-advisor** -- runs at the **spec phase**, before code is written. Reviews spec documents for privacy gaps like unnecessary PII collection, missing anonymization requirements, and unclear data visibility boundaries.
- **privacy-auditor** -- runs at the **code phase**, after implementation. Reviews git diff changes for PII leaks in API responses, logs, federation data, and frontend exposure.

Both agents read from this skill's companion files. This skill gives you direct access to those same standards when implementing features, so you can apply privacy-safe patterns from the start.
