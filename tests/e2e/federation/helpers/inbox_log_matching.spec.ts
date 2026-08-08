/**
 * Unit coverage for the inbox log-poll matcher used by the federation e2e
 * suite.
 *
 * The matcher is the assertion substrate for every log-based federation proof,
 * so it gets direct coverage against captured container-log shapes rather than
 * being exercised only indirectly through Docker-dependent specs. These cases
 * run without the federation environment: they feed fixed log text to a pure
 * function.
 *
 * Fixtures reproduce real `docker logs` output for the federation instances:
 * pino under NODE_ENV=federation renders through pino-pretty, so one log
 * record spans a header line plus indented continuation lines, and keys carry
 * ANSI colour escapes.
 */
import { test, expect } from '@playwright/test';

import { hasAcceptedInboxActivity } from './instances';

const ESC = '\u001b';

/** A rejected activity: arrival is logged, then the 400 at the validation switch. */
const REJECTED_JOIN = [
  `[13:01:27.772] ${ESC}[32mINFO${ESC}[39m (57219): ${ESC}[36mReceived inbox activity${ESC}[39m`,
  `    ${ESC}[35mdomain${ESC}[39m: "activitypub"`,
  `    ${ESC}[35mactivityType${ESC}[39m: "Join"`,
  `    ${ESC}[35mcalendarName${ESC}[39m: "beta_cal"`,
  `[13:01:27.772] ${ESC}[32mINFO${ESC}[39m (57219): ${ESC}[36mInbox activity body${ESC}[39m`,
  `    ${ESC}[35mdomain${ESC}[39m: "activitypub"`,
  `    ${ESC}[35mactivityBody${ESC}[39m: {`,
  '      "type": "Join",',
  '      "id": "https://alpha.federation.local/calendars/a/join",',
  '      "actor": "https://alpha.federation.local/calendars/a"',
  '    }',
  `[13:01:27.772] ${ESC}[31mERROR${ESC}[39m (57219): ${ESC}[36mInvalid activity${ESC}[39m`,
  `    ${ESC}[35mdomain${ESC}[39m: "activitypub"`,
  `    ${ESC}[35mactivityType${ESC}[39m: "Join"`,
  `    ${ESC}[35missues${ESC}[39m: [`,
  '      {',
  '        "path": [',
  '          "object"',
  '        ],',
  '        "message": "Required"',
  '      }',
  '    ]',
].join('\n');

/** An accepted activity: validated, persisted, and logged post-acceptance. */
const ACCEPTED_CREATE_NOTE = [
  `[13:01:28.104] ${ESC}[32mINFO${ESC}[39m (57219): ${ESC}[36mReceived inbox activity${ESC}[39m`,
  `    ${ESC}[35mdomain${ESC}[39m: "activitypub"`,
  `    ${ESC}[35mactivityType${ESC}[39m: "Create"`,
  `    ${ESC}[35mcalendarName${ESC}[39m: "beta_cal"`,
  `[13:01:28.110] ${ESC}[32mINFO${ESC}[39m (57219): ${ESC}[36mInbox activity accepted${ESC}[39m`,
  `    ${ESC}[35mdomain${ESC}[39m: "activitypub"`,
  `    ${ESC}[35minbox${ESC}[39m: "calendar"`,
  `    ${ESC}[35mrecipient${ESC}[39m: "beta_cal"`,
  `    ${ESC}[35mactivityType${ESC}[39m: "Create"`,
  `    ${ESC}[35mactivityId${ESC}[39m: "https://alpha.federation.local/calendars/a/events/e1/note/create"`,
  `    ${ESC}[35mobjectId${ESC}[39m: "https://alpha.federation.local/calendars/a/events/e1/note"`,
].join('\n');

const NOTE_IRI = 'https://alpha.federation.local/calendars/a/events/e1/note';

test.describe('hasAcceptedInboxActivity', () => {

  test('resolves true for an activity that reached the acceptance log record', () => {
    expect(hasAcceptedInboxActivity(ACCEPTED_CREATE_NOTE, 'Create', NOTE_IRI)).toBe(true);
  });

  test('resolves false for an activity rejected at the validation switch', () => {
    // The rejected Join still produced "Received inbox activity" with
    // activityType "Join" and the activity body containing the needle. Only
    // the post-acceptance record may satisfy the matcher.
    expect(
      hasAcceptedInboxActivity(
        REJECTED_JOIN,
        'Join',
        'https://alpha.federation.local/calendars/a',
      ),
    ).toBe(false);
  });

  test('does not combine a needle and an acceptance record from different log records', () => {
    // The needle appears only in an unrelated record; the acceptance record
    // belongs to a different activity. Slice-wide substring matching would
    // wrongly call this a match.
    const unrelated = [
      `[13:01:29.000] ${ESC}[32mINFO${ESC}[39m (57219): ${ESC}[36m[AUTO-REPOST] Called${ESC}[39m`,
      `    ${ESC}[35meventApId${ESC}[39m: "${NOTE_IRI}"`,
    ].join('\n');
    const otherAcceptance = [
      `[13:01:29.500] ${ESC}[32mINFO${ESC}[39m (57219): ${ESC}[36mInbox activity accepted${ESC}[39m`,
      `    ${ESC}[35mactivityType${ESC}[39m: "Create"`,
      `    ${ESC}[35mobjectId${ESC}[39m: "https://alpha.federation.local/calendars/a/events/other"`,
    ].join('\n');

    expect(
      hasAcceptedInboxActivity(`${unrelated}\n${otherAcceptance}`, 'Create', NOTE_IRI),
    ).toBe(false);
  });

  test('resolves false when the acceptance record carries a different activity type', () => {
    expect(hasAcceptedInboxActivity(ACCEPTED_CREATE_NOTE, 'Delete', NOTE_IRI)).toBe(false);
  });

  test('discards continuation lines orphaned by the sinceLine anchor', () => {
    // `tail -n +N` can start the slice in the middle of a record emitted
    // BEFORE the action under test. Those orphaned continuation lines carry no
    // header and must not be treated as part of the following record.
    const orphanedTail = [
      `    ${ESC}[35mactivityType${ESC}[39m: "Create"`,
      `    ${ESC}[35mobjectId${ESC}[39m: "${NOTE_IRI}"`,
      `[13:01:30.000] ${ESC}[32mINFO${ESC}[39m (57219): ${ESC}[36mInbox activity accepted${ESC}[39m`,
      `    ${ESC}[35mactivityType${ESC}[39m: "Announce"`,
      `    ${ESC}[35mobjectId${ESC}[39m: "https://alpha.federation.local/calendars/a/events/other"`,
    ].join('\n');

    expect(hasAcceptedInboxActivity(orphanedTail, 'Create', NOTE_IRI)).toBe(false);
  });

  test('matches acceptance records emitted as single-line JSON', () => {
    // Pretty-printing is a non-production convenience; the matcher must not
    // silently stop working if an instance logs raw pino JSON instead.
    const jsonRecord = JSON.stringify({
      level: 30,
      time: 1754654488110,
      domain: 'activitypub',
      inbox: 'calendar',
      activityType: 'Create',
      objectId: NOTE_IRI,
      msg: 'Inbox activity accepted',
    });

    expect(hasAcceptedInboxActivity(jsonRecord, 'Create', NOTE_IRI)).toBe(true);
  });

});
