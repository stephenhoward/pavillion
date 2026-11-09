import { describe, it, expect } from 'vitest';

import { Calendar } from '@/common/model/calendar';
import { ActivityPubActor, AS_PUBLIC } from '@/server/activitypub/model/base';
import { isPublicOutboxActivity } from '@/server/activitypub/helper/outbox';
import { backfillIsPublic } from '../../../../../migrations/0050_add_ap_outbox_is_public';

/**
 * Public-outbox membership (DEC-024) has two rules: `isPublicOutboxActivity`
 * decides it for every row written from now on, and migration 0050 carries a
 * frozen copy, `backfillIsPublic`, that decided it once for the rows already
 * stored. One case table runs through both, so the two can only differ where a
 * row says they do. They differ in two places, each by ruling:
 *
 *   - no addressing at all is public to the backfill only, because rows
 *     written before public addressing existed carry none;
 *   - the backfill compares the actor's path, not its whole URL, so a changed
 *     instance domain keeps its history.
 */
const calendar = new Calendar('11111111-1111-4111-8111-111111111111', 'ourcal');
const actor = ActivityPubActor.actorUrl(calendar);
const followers = `${actor}/followers`;
const domain = new URL(actor).host;
const userActor = `https://${domain}/users/editor`;
const otherLocalCalendar = `https://${domain}/calendars/othercal`;
const remoteCalendar = 'https://peer.example/calendars/theirs';

type Case = {
  name: string;
  message: unknown;
  helper: boolean;
  backfill: boolean;
};

const cases: Case[] = [
  { name: 'public Create: to as:Public array, cc followers array', message: { actor, to: [AS_PUBLIC], cc: [followers] }, helper: true, backfill: true },
  { name: 'to as:Public as a string', message: { actor, to: AS_PUBLIC }, helper: true, backfill: true },
  { name: 'cc-only as:Public', message: { actor, to: [], cc: [AS_PUBLIC] }, helper: true, backfill: true },
  { name: 'cc followers as a string', message: { actor, cc: followers }, helper: true, backfill: true },
  { name: 'followers-only Update', message: { actor, to: [followers] }, helper: true, backfill: true },
  { name: 'user actor addressed only to a remote calendar', message: { actor: userActor, to: [remoteCalendar] }, helper: false, backfill: false },
  { name: 'user actor addressed as:Public', message: { actor: userActor, to: [AS_PUBLIC], cc: [`${userActor}/followers`] }, helper: false, backfill: false },
  { name: 'another local calendar\'s actor addressed as:Public', message: { actor: otherLocalCalendar, to: [AS_PUBLIC], cc: [`${otherLocalCalendar}/followers`] }, helper: false, backfill: false },
  { name: 'calendar actor addressed only to a remote calendar', message: { actor, to: [remoteCalendar] }, helper: false, backfill: false },
  { name: 'another actor\'s followers collection only', message: { actor, cc: [`${remoteCalendar}/followers`] }, helper: false, backfill: false },
  { name: 'bto-only', message: { actor, to: [], cc: [], bto: [remoteCalendar] }, helper: false, backfill: false },
  { name: 'missing actor', message: { to: [AS_PUBLIC], cc: [followers] }, helper: false, backfill: false },
  { name: 'actor that is not a string', message: { actor: { id: actor }, to: [AS_PUBLIC] }, helper: false, backfill: false },
  { name: 'message that is not an object', message: 'not a message', helper: false, backfill: false },
  { name: 'null message', message: null, helper: false, backfill: false },
  // Differences by ruling, labelled so a failure says which rule moved.
  { name: 'no addressing at all (helper: not public; backfill: public)', message: { actor }, helper: false, backfill: true },
  { name: 'empty arrays and empty strings count as no addressing (helper: not public; backfill: public)', message: { actor, to: [], cc: '', bto: null, bcc: [], audience: [] }, helper: false, backfill: true },
  { name: 'same path on another host (helper: not public; backfill: public, path-only by ruling)', message: { actor: 'https://old-domain.example/calendars/ourcal', to: [AS_PUBLIC] }, helper: false, backfill: true },
  { name: 'actor path that only starts with the calendar path', message: { actor: `${actor}-evil`, to: [AS_PUBLIC], cc: [`${actor}-evil/followers`] }, helper: false, backfill: false },
  { name: 'unparseable actor URL', message: { actor: 'not a url', to: [AS_PUBLIC] }, helper: false, backfill: false },
];

describe('public-outbox membership', () => {
  describe('isPublicOutboxActivity (new rows)', () => {
    it.each(cases)('$name → $helper', ({ message, helper }) => {
      expect(isPublicOutboxActivity(calendar, message as Record<string, unknown>)).toBe(helper);
    });
  });

  describe('migration 0050 backfillIsPublic (stored rows)', () => {
    it.each(cases)('$name → $backfill', ({ message, backfill }) => {
      expect(backfillIsPublic(message, calendar.urlName)).toBe(backfill);
    });

    it('is not public when the row\'s calendar has no url_name', () => {
      expect(backfillIsPublic({ actor, to: [AS_PUBLIC] }, null)).toBe(false);
      expect(backfillIsPublic({ actor, to: [AS_PUBLIC] }, '')).toBe(false);
    });
  });
});
