# Federation Privacy

> Version: 1.0.0
> Last Updated: 2026-03-22

## Privacy Risks

- **Actor profile PII exposure**: ActivityPub actor profiles that include account email, real name, or internal IDs
- **Event author attribution**: Outbound events that attribute content to a specific user account rather than the calendar
- **Follower list exposure**: Exposing who follows a calendar reveals user preferences and associations
- **Inbox content logging**: Logging full inbound activities may capture PII from remote users
- **Remote actor data retention**: Storing more profile data from remote actors than necessary for federation
- **Report forwarding PII**: Forwarding moderation reports to remote instances may expose reporter identity

## Safe Patterns

### Actor Profile Minimal Data

Calendar actor profiles should expose only what federation requires:

```typescript
// Safe: UserProfileResponse exposes only federation-required fields
// id, type, preferredUsername, inbox, outbox, publicKey
// No email, no account reference, no owner identity
new UserProfileResponse(calendar.urlName, domain, publicKey);
```

### Event Attribution to Calendar, Not User

Outbound events should be attributed to the calendar actor, not the user who created them:

```typescript
// Safe: event attributed to calendar actor
const activity = {
  actor: `https://${domain}/calendars/${calendar.urlName}`,
  // NOT: actor: `https://${domain}/users/${account.username}`
  object: eventObject,
};
```

### Remote Actor Data Minimization

Store only what's needed for federation mechanics:

```typescript
// Safe: store minimal remote actor data
await updateRemoteCalendar(actorUri, {
  name: profile.name || profile.preferredUsername,
  description: profile.summary,
  publicKey: profile.publicKey,
  // NOT storing: email, location, birthday, or other profile fields
});
```

### Report Forwarding Privacy

When forwarding Flag activities to remote instances, strip reporter identity:

```typescript
// Safe: forward report without reporter PII
const flagActivity = {
  actor: instanceActorUri,  // Instance actor, not reporter
  object: reportedContentUri,
  content: report.description,
  // NOT including: reporter email, reporter account ID, reporter IP
};
```

## Leaky Patterns

### Actor Profile with Account PII

```typescript
// LEAKY: actor profile includes account email or internal ID
return {
  ...actorProfile,
  email: account.email,           // Federation doesn't need this
  accountId: account.id,          // Internal ID leaked to remote instances
};
```

### Event with Creator Identity

```typescript
// LEAKY: outbound event attributes content to a user, not the calendar
const activity = {
  actor: `https://${domain}/users/${account.username}`,  // Exposes user identity
  object: eventObject,
};
```

### Logging Full Inbound Activities

```typescript
// LEAKY: logging full activity dumps remote user PII
logger.info({ activity: req.body }, 'Received inbox activity');
// May contain actor profile data, email addresses from remote instances
```

### Follower List as Public Endpoint

```typescript
// LEAKY: public follower list exposes who follows what
app.get('/calendars/:name/followers', (req, res) => {
  res.json(followers);  // Reveals user interests and associations
});
```

## Known Codebase Patterns

- `UserProfileResponse` in `src/server/activitypub/model/userprofile.ts` returns: `id, type, preferredUsername, inbox, outbox, publicKey` -- no PII (good)
- Calendar actors use calendar `urlName` as `preferredUsername`, not account username
- Remote calendar metadata stored via `updateRemoteCalendar()` in `src/server/activitypub/service/remote_calendar.ts`
- Report forwarding in moderation service uses `forwardReport()` -- verify reporter identity is stripped
- Event serialization in `src/server/activitypub/model/object/event.ts` -- verify no account PII in outbound events
- Follower records in `FollowerCalendarEntity` store `calendar_actor_id` (remote actor reference), not personal data
