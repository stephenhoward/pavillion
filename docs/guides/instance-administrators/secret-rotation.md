---
description: Rotate the secrets your Pavillion instance depends on — JWT, session, database password, SMTP, S3 — without locking your users out longer than necessary.
---

# Rotating secrets

> Status: placeholder. This guide will be written before launch.

You rotate secrets when you suspect they've leaked, when someone with access has left, when an audit asks, or on a calendar you've set for yourself. Pavillion's secrets aren't all equal — some rotations are invisible to users, some log everyone out, one of them locks you out of your own database if you do it wrong.

## Planned scope

- The secrets, in order of blast radius: `JWT_SECRET` (rotating logs everyone out), `SESSION_SECRET` (rotating invalidates sessions), `DB_PASSWORD` (rotating without coordination locks the app out of the database), `SMTP_PASSWORD` (rotating breaks outbound mail until updated), `S3_SECRET_KEY` (rotating breaks media uploads until updated), Stripe keys (rotating breaks the funding-plan checkout flow)
- The rotation procedure, by secret: generate a new value, update the secret file or `.env`, restart the relevant containers, confirm
- The "rotate the database password without losing access" procedure — change it in the database first, then in the secret, then restart. Order matters
- When to rotate on a schedule and when scheduled rotation is security theater. Honest about both
- Coordinated rotation when secrets are shared across systems (SMTP credentials in the SMTP provider's dashboard, S3 keys in the bucket policy)
- The "I rotated something and now X is broken" recovery path
