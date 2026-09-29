/**
 * An inbound Join is answered with an Ignore that embeds the Join as its
 * `object`. The Join is peer-supplied and its schema passes unknown keys
 * through, so embedding it whole would make every Join an unbounded durable
 * write into ap_outbox (and an echo of the peer's payload back to the peer).
 * This pins the persisted row to the reduced reference.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import { ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

const PUBLIC_URI = 'https://www.w3.org/ns/activitystreams#Public';

describe('Join → Ignore outbox persistence', () => {
  let env: TestEnvironment;
  let calendar: Calendar;
  let inboxService: ProcessInboxService;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    await configurationInterface.setSetting('registrationMode', 'open');
    const accountsInterface = new AccountsInterface(
      eventBus, configurationInterface, new SetupInterface(), new EmailInterface(),
    );
    const calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);

    const account = await accountsInterface.registerNewAccount('join-ignore@pavillion.dev') as Account;
    calendar = await calendarInterface.createCalendar(account, 'joinignorecal');

    inboxService = new ProcessInboxService(eventBus, calendarInterface);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('persists only the reduced Join reference, not the peer-supplied payload', async () => {
    const senderActor = 'https://remote.example/users/bob';
    const joinId = 'https://remote.example/activities/join/1';
    const join = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: joinId,
      type: 'Join',
      actor: senderActor,
      object: `${ActivityPubActor.actorUrl(calendar)}/events/abc`,
      to: [PUBLIC_URI],
      content: 'x'.repeat(50_000),
      unknownBlob: { nested: { deep: 'y'.repeat(10_000) } },
    };

    await inboxService.processJoinActivity(calendar, join);

    const rows = await ActivityPubOutboxMessageEntity.findAll({
      where: { calendar_id: calendar.id, type: 'Ignore' },
    });
    expect(rows).toHaveLength(1);
    const message = rows[0].message as Record<string, any>;

    expect(message.object).toEqual({ id: joinId, type: 'Join', actor: senderActor });
    expect(message.object).not.toHaveProperty('content');
    expect(message.object).not.toHaveProperty('unknownBlob');
    expect(message.object).not.toHaveProperty('object');
    expect(message.object).not.toHaveProperty('to');
    expect(message.object).not.toHaveProperty('@context');
    expect(JSON.stringify(message)).not.toContain('xxxxxxxxxx');
    expect(JSON.stringify(message)).not.toContain('yyyyyyyyyy');

    // Addressing unchanged: direct to the sender, never public.
    expect(message.to).toEqual([senderActor]);
    expect(message.cc ?? []).not.toContain(PUBLIC_URI);
  });
});
