---
description: Choose between local filesystem and S3-compatible storage for Pavillion media uploads — and migrate from one to the other without losing anything.
---

# Media storage

> Status: placeholder. This guide will be written before launch.

Pavillion stores uploaded media (event images, calendar avatars, banners) on a volume by default. That's fine for small instances. As your instance grows, or if you're running multiple app containers, S3-compatible object storage becomes the better fit. This guide names the choice and covers the migration path.

## Planned scope

- The default: a Docker volume mounted at `/app/storage/media`. What this means for backups, for restoring, for moving servers
- When to switch to S3-compatible storage: more than one app container, media volume getting unwieldy in backups, you want a CDN in front, you don't want media tied to the server's disk
- Supported providers: AWS S3, DigitalOcean Spaces, Backblaze B2, MinIO, anything that speaks the S3 API
- The configuration: `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT` for non-AWS providers
- Migrating an existing instance from local to S3 without losing media: the order of operations, the cutover, the "did anything fail to copy" verification step
- The "do not delete the media volume the day you switch to S3" warning — keep it as a fallback until you've verified
