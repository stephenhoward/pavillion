# Email Communication Privacy

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **Reply-To exposing account emails**: Outbound emails with reply-to headers set to user account emails
- **Email headers with PII**: Custom headers that embed account IDs, usernames, or internal references
- **CC/BCC leaking recipients**: Group notifications that expose recipient lists
- **Email template PII**: Templates that include more account data than necessary
- **Verification tokens in logs**: Logging email content that includes verification URLs with tokens

## Safe Patterns

### System-Only Sender

All outbound emails should use the system sender address, never user emails:

```typescript
// Safe: system-only from/reply-to
const mailData: MailData = {
  from: config.get('email.from'),  // noreply@instance.domain
  to: recipient.email,
  subject: subject,
  // NOT: replyTo: invitingUser.email
};
```

### Minimal Template Data

Pass only the data the email template needs:

```typescript
// Safe: invitation email includes calendar name, not inviter's email
const templateData = {
  calendarName: calendar.content(lang).title,
  invitationLink: `https://${domain}/invite/${token}`,
  // NOT: inviterEmail, inviterUsername, inviterAccountId
};
```

### Verification Email Privacy

```typescript
// Safe: verification email doesn't reveal who reported
const templateData = {
  verificationLink: `https://${domain}/verify-report/${token}`,
  eventTitle: event.title,
  // NOT: reporterName, otherReporterEmails, adminNotes
};
```

## Leaky Patterns

### Exposing User Email as Reply-To

```typescript
// LEAKY: sets reply-to as the inviting user's email
mailData.replyTo = invitingUser.email;
// Recipient now has the inviter's email address
```

### Over-Sharing in Templates

```typescript
// LEAKY: escalation email includes reporter's personal details
const templateData = {
  reporterEmail: report.reporterEmail,  // Admin doesn't need plaintext email
  reporterIp: report.ip,                // Raw IP in email
};
```

## Known Codebase Patterns

- Email service in `src/server/email/service/email.ts` with transport abstraction
- Multiple transports: SMTP, development (console), testing (in-memory), mailpit, sendmail
- Email templates use Handlebars
- Moderation events send verification emails to anonymous reporters (`src/server/moderation/events/index.ts`)
- Reporter email passed in event payload as `reporterEmail` -- verify it's only used for sending, not stored
