---
description: Configure transactional email for Pavillion — SMTP setup plus the deliverability work (SPF, DKIM, DMARC) that determines whether your password resets actually arrive.
---

# Email

> Status: placeholder. This guide will be written before launch.

Pavillion sends email for password resets, editor invitations, calendar-owner notifications, and a handful of other low-volume transactional cases. SMTP setup is the easy half. Deliverability — whether the mail actually reaches inboxes — is the harder half, and the part most generic deployment docs skip.

## Planned scope

- SMTP configuration in `config/local.yaml`: host, port, secure flag, from address, credentials
- Why a dedicated transactional sender (Postmark, Mailgun, SES, Resend) usually beats sending through a shared mailbox or your ISP
- The deliverability checklist: SPF, DKIM, DMARC, and what each one actually does to your reputation
- Testing your setup before anyone signs up — the password-reset round-trip, what the message looks like to a recipient, how to read a bounce
- The "my users report password-reset email goes to spam" debugging path
- Notes on rate limits and how Pavillion batches notification email

::: tip <Lightbulb /> A note on the From address.
:::

The note above is a reminder for the writer: the From address has to match the domain whose DNS you control, not just any address you'd like to use. Detail goes in the body.
