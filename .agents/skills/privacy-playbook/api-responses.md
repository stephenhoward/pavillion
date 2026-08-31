# API Response Privacy

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **Account IDs in public responses**: Public API responses that include `accountId` or `createdBy` fields link events to specific users
- **Email addresses in any API response**: Account emails should never appear in responses to other users
- **`toObject()` over-exposure**: Using model `toObject()` directly in responses may include fields not intended for the audience
- **Editor lists exposing emails**: Calendar editor lists returning email addresses to non-admin users
- **Invitation details leaking**: Editor invitation responses exposing recipient email to non-owner users
- **Funding plan owner exposure**: Funding plan responses including `accountId` of the plan creator

## Safe Patterns

### Public API Response Field Selection

Public endpoints must use explicit field selection, never raw `toObject()`:

```typescript
// Safe: explicit fields for public calendar response
// Calendar.toObject() is safe -- it returns: id, urlName, description, languages, defaultDateRange, content
// It does NOT include accountId or owner information
res.json(calendar.toObject());

// Safe: explicit fields when toObject() might include sensitive data
res.json({
  id: event.id,
  title: event.content(lang).title,
  startDate: event.startDate,
  location: event.location?.name,
  // NOT including: event.accountId, event.createdBy
});
```

### Authenticated API Response Field Filtering

Even for authenticated endpoints, apply the principle of minimal data:

```typescript
// Safe: return collaborator display names, not emails
res.json(editors.map(editor => ({
  id: editor.id,
  displayName: editor.displayName || editor.username,
  role: editor.role,
  // NOT including: editor.email (only the calendar owner needs this)
})));
```

### Account Information

The Account model's `toObject()` includes email. Only return it to the account owner:

```typescript
// Safe: account info returned only to the account owner
res.json(account.toObject()); // Only on GET /api/v1/account (own account)

// NEVER return another user's account.toObject() -- it includes email
```

## Leaky Patterns

### Raw toObject() in Public Endpoints

```typescript
// LEAKY (potential): if the model's toObject() includes accountId or createdBy
res.json(event.toObject());
// Always verify what toObject() returns before using in public endpoints
```

### Exposing Other Users' Emails

```typescript
// LEAKY: editor list includes email addresses
res.json(editors.map(e => ({
  id: e.id,
  username: e.username,
  email: e.email,  // Other users should not see this
  role: e.role,
})));
```

### Account ID in Public Event Responses

```typescript
// LEAKY: public event response includes who created it
res.json({
  ...event.toObject(),
  createdBy: event.accountId,  // Links event to specific account
});
```

### Invitation Recipient Exposure

```typescript
// LEAKY: invitation list shows recipient emails to non-owners
res.json(invitations.map(inv => inv.toObject()));
// CalendarEditorInvitation.toObject() includes email field
```

## Known Codebase Patterns

- `Account.toObject()` returns: `id, username, email, displayName, roles, language` -- email is included
- `Calendar.toObject()` returns: `id, urlName, description, languages, defaultDateRange, widgetAllowedDomain, content` -- no PII
- `CalendarEditorInvitation.toObject()` includes `email` field
- `Notification.toObject()` intentionally excludes `account_id` (documented in model comments)
- `FundingPlan.toObject()` includes `accountId`
- Public API routes in `src/server/public/api/v1/` use `calendar.toObject()` and `event.toObject()` -- verify these don't leak PII
- Public endpoints use `toObject()` for calendars, events, categories, series, and event instances
