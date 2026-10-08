/**
 * An inbound Accept embeds the activity being accepted as its `object`. The
 * Accept schema passes unknown keys through, and the inbound row persists the
 * model instance (not a re-serialized copy), so the model's reduction is the
 * only bound on what a peer can make the instance store in ap_inbox. This pins
 * the persisted row to the reduced reference.
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
import ActivityPubInterface from '@/server/activitypub/interface';
import AcceptActivity from '@/server/activitypub/model/action/accept';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

describe('Inbound Accept inbox persistence', () => {
  let env: TestEnvironment;
  let calendar: Calendar;
  let activityPubInterface: ActivityPubInterface;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    // Bare EventEmitter with no inbox subscriber, so the row is written but
    // never drained.
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    await configurationInterface.setSetting('registrationMode', 'open');
    const accountsInterface = new AccountsInterface(
      eventBus, configurationInterface, new SetupInterface(configurationInterface), new EmailInterface(),
    );
    const calendarInterface = new CalendarInterface(eventBus, accountsInterface);

    const account = await accountsInterface.registerNewAccount('accept-inbox@pavillion.dev') as Account;
    calendar = await calendarInterface.createCalendar(account, 'acceptinboxcal');

    activityPubInterface = new ActivityPubInterface(eventBus, calendarInterface, accountsInterface);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it('persists only the reduced Follow reference, not the peer-supplied payload', async () => {
    const remoteActor = 'https://remote.example/calendars/theirs';
    const localActor = ActivityPubActor.actorUrl(calendar);
    const followId = `${localActor}/follows/1`;

    const accept = AcceptActivity.fromObject({
      id: 'https://remote.example/calendars/theirs/accepts/1',
      actor: remoteActor,
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: followId,
        type: 'Follow',
        actor: localActor,
        object: remoteActor,
        content: 'x'.repeat(50_000),
        unknownBlob: { nested: { deep: 'y'.repeat(10_000) } },
      },
    });
    expect(accept).not.toBeNull();

    await activityPubInterface.addToInbox(calendar, accept!, {
      source: 'http_signature',
      origin: 'https://remote.example',
    });

    const row = await ActivityPubInboxMessageEntity.findByPk(accept!.id);
    expect(row).not.toBeNull();
    const message = row!.message as Record<string, any>;

    expect(message.object).toEqual({ id: followId, type: 'Follow', actor: localActor, object: remoteActor });
    expect(JSON.stringify(message)).not.toContain('xxxxxxxxxx');
    expect(JSON.stringify(message)).not.toContain('yyyyyyyyyy');
  });
});
