# DEC-023: Recurrence Time Zone Conventions

> Date: 2026-11-06
> Status: Accepted
> Category: Technical
> Stakeholders: Tech Lead, Calendar Owners

## Decision

A recurring event keeps its local time across daylight-saving changes. Six rules govern how zones are used, and one accepted exposure is recorded.

**1. Recurrence expands in the base schedule's zone.** Each occurrence steps in wall-clock time in the IANA zone of the event's base schedule. Expansion uses a floating wall-clock frame (`WallClockFrame` in `src/server/calendar/service/event_instance.ts`), not rrule's `tzid` option, because `tzid` takes offsets from the process zone and results would differ between machines. A schedule stored with zone `UTC` expands as a plain UTC series.

**2. The base schedule is the earliest non-exclusion schedule, ties broken by id.** `CalendarEvent.baseSchedule()` (using `compareSchedulesByStart`) picks it. Schedules load in no fixed order, so the choice must never depend on load order, and every caller (expansion, ActivityPub serialization) uses this one method.

**3. Exclusion rows are stored as UTC instants.** Cancellations are `timezone = 'UTC'` rows holding the true instant of the occurrence they cancel. They are converted into the event's frame when expansion runs.

**4. List and calendar views show the viewer's zone.** Occurrences are rendered in the zone of whoever is looking. This is an interim convention; showing an event's own zone, labelled, is tracked separately.

**5. The editor shows the schedule's own zone.** The zone select is initialized from the loaded schedule, so editing from a different browser zone does not move the instant.

**6. The wire format carries the zone per schedule.** The schedule's `timezone` is carried on the wire and stored per schedule.

**Accepted exposure: hidden cancellations federate.** A cancellation that is hidden from the public stays in `pavillion:schedules` on the ActivityPub object so that peers can honour it. The public API strips schedules (`toPublicEventObject` in `src/server/public/api/v1/calendar.ts` drops them), but the ActivityPub object is fetchable by anyone, so a hidden date is readable by anyone who fetches that object. This exposure is accepted by the owner (2026-11-06). It is an owner-configuration disclosure, not a [DEC-004](dec-004-privacy-first-public-access.md) matter: no attendee or visitor data is involved.

## Context

The zone-aware recurrence work made the schedule's IANA zone survive from the editor to the database and made expansion step in that zone. The rules above were settled during that work and lived only in bead notes while further changes to this code were pending. The follow-up work on a single zone per event and on re-keying cancellations when the zone changes builds on them.

## Alternatives Considered

- **rrule `tzid`:** rejected; its offset arithmetic depends on the process zone.
- **Storing exclusion rows in the event's zone:** rejected; a true instant stays correct when the zone changes and is what cancellation matching compares.
- **Stripping hidden cancellations from `pavillion:schedules`:** rejected by the owner; peers could then not honour them.

## Rationale

Wall-clock stepping in a named zone is the only behaviour that matches what organizers mean by "every Tuesday at 10:15". Keeping expansion independent of the process zone makes results reproducible across development machines, CI and production. Keeping hidden cancellations in the federated object preserves peers' ability to honour them, at the cost of the accepted exposure.

## Consequences

- Code that picks a schedule for an event must use `baseSchedule()`.
- A change to an event's zone must move its cancellation rows to the instants of the occurrences they cancel.
- Anyone fetching an event's ActivityPub object can read hidden cancellation dates.
- Deployments run in UTC and do not set `TZ` (see `docs/deployment.md`).
