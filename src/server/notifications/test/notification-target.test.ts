import { describe, it, expect } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import {
  collectTargetCalendarIds,
  deriveTarget,
  type TargetActivity,
  type TargetDerivationContext,
} from '@/server/notifications/service/notification-target';
import type { NotificationVerb } from '@/server/notifications/types';

/**
 * Unit matrix for the pure target derivation (pv-mvfk.3).
 *
 * The derivation is extracted from the service so the per-verb rules are
 * testable without a database or a service instance — the same split
 * `role-resolver.ts` and `anonymize-flag-actor.ts` already use.
 *
 * The matrix is deliberately NOT a verb x role cross-product. Verbs whose
 * target does not depend on the viewer's role get one case; only the report
 * verbs, where the role decides the surface, get the role split.
 */
describe('deriveTarget', () => {
  const CALENDAR_ID = uuidv4();
  const OTHER_CALENDAR_ID = uuidv4();
  const EVENT_ID = uuidv4();
  const REPORT_ID = uuidv4();

  /**
   * Builds an activity row projection. Only the three fields the derivation
   * reads are modelled — the derivation must never grow a dependency on
   * actor identity or the label snapshot.
   */
  function activity(overrides: Partial<TargetActivity> & { verb: NotificationVerb }): TargetActivity {
    return {
      object_id: overrides.object_id ?? uuidv4(),
      object_calendar_id: 'object_calendar_id' in overrides ? overrides.object_calendar_id ?? null : null,
      verb: overrides.verb,
    };
  }

  function context(
    isAdmin: boolean,
    urlNames: Record<string, string> = {},
  ): TargetDerivationContext {
    return {
      isAdmin,
      calendarUrlNames: new Map(Object.entries(urlNames)),
    };
  }

  // -------------------------------------------------------------------------
  // Verbs whose target does not depend on the viewer
  // -------------------------------------------------------------------------

  it('returns null for Follow — the object is the recipient\'s own calendar', () => {
    const row = activity({ verb: 'Follow', object_id: CALENDAR_ID });

    expect(deriveTarget(row, context(false, { [CALENDAR_ID]: 'mycal' }))).toBeNull();
    expect(deriveTarget(row, context(true, { [CALENDAR_ID]: 'mycal' }))).toBeNull();
  });

  it('returns null for EditorRevoked even though object_type is calendar', () => {
    // The verb-not-object_type rule in its sharpest form: the calendar id IS
    // resolvable here, so an implementation that switched on object_type
    // would emit a live link to a calendar the recipient just lost access to.
    const row = activity({ verb: 'EditorRevoked', object_id: CALENDAR_ID });

    expect(deriveTarget(row, context(false, { [CALENDAR_ID]: 'mycal' }))).toBeNull();
  });

  it('keys on verb, not object_type: EditorInvited and EditorRevoked diverge on identical rows', () => {
    // Both verbs emit object_type='calendar' with object_id = calendarId
    // (events/index.ts). Same row shape, same resolvable calendar, opposite
    // outcomes — only the verb separates them.
    const ctx = context(false, { [CALENDAR_ID]: 'mycal' });
    const invited = activity({ verb: 'EditorInvited', object_id: CALENDAR_ID });
    const revoked = activity({ verb: 'EditorRevoked', object_id: CALENDAR_ID });

    expect(deriveTarget(invited, ctx)).toEqual({ kind: 'calendar', calendarUrlName: 'mycal' });
    expect(deriveTarget(revoked, ctx)).toBeNull();
  });

  it('returns an event target for Announce', () => {
    // Invariant 4: every event target is an event the recipient can edit —
    // Announce rows go to the reposted event's calendar editors.
    const row = activity({ verb: 'Announce', object_id: EVENT_ID });

    expect(deriveTarget(row, context(false))).toEqual({ kind: 'event', eventId: EVENT_ID });
  });

  it('returns a calendar target for EditorInvited when the calendar resolves', () => {
    const row = activity({ verb: 'EditorInvited', object_id: CALENDAR_ID });

    expect(deriveTarget(row, context(false, { [CALENDAR_ID]: 'mycal' })))
      .toEqual({ kind: 'calendar', calendarUrlName: 'mycal' });
  });

  it('returns null for EditorInvited when the calendar cannot be resolved', () => {
    // Deleted calendar, or a row older than the calendar it names. The row
    // still renders from its label snapshot; it just is not navigable.
    const row = activity({ verb: 'EditorInvited', object_id: CALENDAR_ID });

    expect(deriveTarget(row, context(false, { [OTHER_CALENDAR_ID]: 'other' }))).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Report verbs — the viewer's role decides the surface
  // -------------------------------------------------------------------------

  const reportVerbs: NotificationVerb[] = ['Flag', 'ReportEscalated', 'ReportResolved'];

  for (const verb of reportVerbs) {
    describe(verb, () => {
      it('sends an instance admin to the moderation queue', () => {
        const row = activity({ verb, object_id: REPORT_ID, object_calendar_id: CALENDAR_ID });

        expect(deriveTarget(row, context(true, { [CALENDAR_ID]: 'mycal' })))
          .toEqual({ kind: 'moderation_report', reportId: REPORT_ID });
      });

      it('sends a calendar owner to their own calendar\'s reports tab', () => {
        const row = activity({ verb, object_id: REPORT_ID, object_calendar_id: CALENDAR_ID });

        expect(deriveTarget(row, context(false, { [CALENDAR_ID]: 'mycal' })))
          .toEqual({ kind: 'owner_report', reportId: REPORT_ID, calendarUrlName: 'mycal' });
      });

      it('returns null for a non-admin when the owning calendar cannot be resolved', () => {
        const row = activity({ verb, object_id: REPORT_ID, object_calendar_id: CALENDAR_ID });

        expect(deriveTarget(row, context(false, {}))).toBeNull();
      });
    });
  }

  it('returns null for a non-admin when object_calendar_id is NULL', () => {
    // Two real sources of NULL: an admin reporting a remote event (no local
    // calendar owns it) and every row written before migration 0040. Neither
    // is an error, and neither may throw.
    const row = activity({ verb: 'Flag', object_id: REPORT_ID, object_calendar_id: null });

    expect(() => deriveTarget(row, context(false, { [CALENDAR_ID]: 'mycal' }))).not.toThrow();
    expect(deriveTarget(row, context(false, { [CALENDAR_ID]: 'mycal' }))).toBeNull();
  });

  it('still sends an admin to the moderation queue when object_calendar_id is NULL', () => {
    // The moderation surface is addressed by report id alone, so the missing
    // calendar costs the admin nothing.
    const row = activity({ verb: 'Flag', object_id: REPORT_ID, object_calendar_id: null });

    expect(deriveTarget(row, context(true)))
      .toEqual({ kind: 'moderation_report', reportId: REPORT_ID });
  });

  it('gives a dual-role viewer the moderation surface (invariant 2)', () => {
    // Admin AND owner of the flagged calendar: isAdmin wins. This is a
    // decision, not an accident of branch order — an admin's moderation queue
    // is the surface with the full action set.
    const row = activity({ verb: 'Flag', object_id: REPORT_ID, object_calendar_id: CALENDAR_ID });

    expect(deriveTarget(row, context(true, { [CALENDAR_ID]: 'mycal' })))
      .toEqual({ kind: 'moderation_report', reportId: REPORT_ID });
  });

  it('makes an unresolvable report indistinguishable from a non-navigable verb', () => {
    // DEC-004: a non-admin whose report calendar cannot be resolved gets the
    // exact same shape as Follow — a client cannot tell "no link for this
    // verb" from "you are not entitled to this calendar".
    const unresolvable = deriveTarget(
      activity({ verb: 'Flag', object_id: REPORT_ID, object_calendar_id: OTHER_CALENDAR_ID }),
      context(false, {}),
    );
    const nonNavigable = deriveTarget(
      activity({ verb: 'Follow', object_id: CALENDAR_ID }),
      context(false, {}),
    );

    expect(unresolvable).toEqual(nonNavigable);
  });

  it('degrades an unrecognised verb to plain text rather than throwing', () => {
    // The verb column is a DB enum; a row written by a newer instance (or a
    // widened enum ahead of this switch) must not break an inbox page load.
    const row = { verb: 'Undo' as NotificationVerb, object_id: EVENT_ID, object_calendar_id: null };

    expect(deriveTarget(row, context(false))).toBeNull();
  });
});

describe('collectTargetCalendarIds', () => {
  const CAL_A = uuidv4();
  const CAL_B = uuidv4();

  function row(verb: NotificationVerb, objectId: string, calendarId: string | null = null): TargetActivity {
    return { verb, object_id: objectId, object_calendar_id: calendarId };
  }

  it('collects the calendar id from EditorInvited rows', () => {
    const ids = collectTargetCalendarIds([row('EditorInvited', CAL_A)], false);

    expect([...ids]).toEqual([CAL_A]);
  });

  it('collects object_calendar_id from report rows for a non-admin', () => {
    const ids = collectTargetCalendarIds([row('Flag', uuidv4(), CAL_A)], false);

    expect([...ids]).toEqual([CAL_A]);
  });

  it('collects nothing from report rows for an admin', () => {
    // The moderation surface needs no calendar, so an admin's inbox skips the
    // lookup entirely — and a page of only report rows issues no query at all.
    const ids = collectTargetCalendarIds(
      [row('Flag', uuidv4(), CAL_A), row('ReportResolved', uuidv4(), CAL_B)],
      true,
    );

    expect(ids.size).toBe(0);
  });

  it('collects nothing from Follow, Announce, or EditorRevoked rows', () => {
    const ids = collectTargetCalendarIds(
      [row('Follow', CAL_A), row('Announce', uuidv4()), row('EditorRevoked', CAL_B)],
      false,
    );

    expect(ids.size).toBe(0);
  });

  it('dedupes calendar ids shared across rows', () => {
    const ids = collectTargetCalendarIds(
      [
        row('EditorInvited', CAL_A),
        row('EditorInvited', CAL_A),
        row('Flag', uuidv4(), CAL_A),
        row('Flag', uuidv4(), CAL_B),
      ],
      false,
    );

    expect(ids.size).toBe(2);
    expect(ids.has(CAL_A)).toBe(true);
    expect(ids.has(CAL_B)).toBe(true);
  });

  it('skips NULL object_calendar_id rather than collecting a null key', () => {
    const ids = collectTargetCalendarIds([row('Flag', uuidv4(), null)], false);

    expect(ids.size).toBe(0);
  });
});
