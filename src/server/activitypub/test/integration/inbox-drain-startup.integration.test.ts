/**
 * The web process drains rows left unprocessed by an earlier run.
 *
 * A row the worker wrote (backfill), or one whose live dispatch was cut off by
 * a restart, has `processed_time: null` and no `inboxMessageAdded` emit left
 * to deliver it. The startup drain is what dispatches it, through the same
 * gates as live delivery. Each row here is written before the domain exists,
 * then a fresh ActivityPubDomain is wired as the web process wires it, with a
 * moderation interface reading the real block list, and its drain is started.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import ActivityPubDomain from '@/server/activitypub';
import ActivityPubInterface from '@/server/activitypub/interface';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import HousekeepingInterface from '@/server/housekeeping/interface';
import ModerationInterface from '@/server/moderation/interface';
import EmailInterface from '@/server/email/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import { ActivityPubInboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { BlockedInstanceEntity } from '@/server/moderation/entity/blocked_instance';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';
import { waitFor } from '@/server/common/test/lib/test_polling';

const BLOCKED_HOST = 'blocked.example';

describe('ActivityPubDomain startup inbox drain (integration)', () => {
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox;
  let stopDrain: (() => void) | undefined;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    await BlockedInstanceEntity.create({
      id: uuidv4(),
      domain: BLOCKED_HOST,
      reason: 'Test defederation',
      blocked_at: new Date(),
      blocked_by: uuidv4(),
    });
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    stopDrain?.();
    stopDrain = undefined;
    sandbox.restore();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  /** Creates a local calendar and returns its id. */
  async function createCalendar(urlName: string): Promise<string> {
    const calendarId = uuidv4();
    await CalendarEntity.create({
      id: calendarId,
      url_name: urlName,
      account_id: uuidv4(),
      languages: 'en',
    });
    return calendarId;
  }

  /** Writes an unprocessed inbox row, as an earlier run would have left it. */
  async function leaveUnprocessedRow(calendarId: string, message: Record<string, unknown>): Promise<string> {
    const rowId = message.id as string;
    await ActivityPubInboxMessageEntity.create({
      id: rowId,
      type: message.type,
      message_time: new Date(),
      message,
      calendar_id: calendarId,
    });
    return rowId;
  }

  /**
   * Wires an ActivityPubDomain as the web process does, with a moderation
   * interface whose block list is the real table. Returns the domain's inbox
   * service so a test can watch the Create handler; the drain is not started.
   */
  function wireDomain(): { domain: ActivityPubDomain; inboxService: ProcessInboxService } {
    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const accountsInterface = new AccountsInterface();
    const moderationInterface = new ModerationInterface(
      eventBus,
      calendarInterface,
      accountsInterface,
      sandbox.createStubInstance(EmailInterface) as unknown as EmailInterface,
      sandbox.createStubInstance(ConfigurationInterface) as unknown as ConfigurationInterface,
      sandbox.createStubInstance(ActivityPubInterface) as unknown as ActivityPubInterface,
    );
    const domain = new ActivityPubDomain(
      eventBus,
      calendarInterface,
      accountsInterface,
      { publishJob: async () => {} } as unknown as HousekeepingInterface,
      moderationInterface,
    );
    domain.installEventHandlers();
    const inboxService = (domain.interface as unknown as { inboxService: ProcessInboxService }).inboxService;
    return { domain, inboxService };
  }

  /** Waits until the drain has marked the row processed, and returns it. */
  function waitForProcessed(rowId: string): Promise<ActivityPubInboxMessageEntity> {
    return waitFor(async () => {
      const found = await ActivityPubInboxMessageEntity.findByPk(rowId);
      return found?.processed_time ? found : null;
    }, { label: `row ${rowId} processed` });
  }

  it('dispatches a row left unprocessed before the web process started', async () => {
    const calendarId = await createCalendar('drainstartup');
    // Left over from before the start: no live emit will ever deliver it.
    const rowId = await leaveUnprocessedRow(calendarId, {
      id: 'https://remote.example/activities/left-over-ignore',
      type: 'Ignore',
      actor: 'https://remote.example/calendars/remote',
      object: 'https://pavillion.dev/activities/some-join',
    });

    const { domain } = wireDomain();
    stopDrain = domain.startInboxDrain();

    expect((await waitForProcessed(rowId)).processed_status).toBe('ok');
  });

  it('marks a left-over row from a blocked instance blocked without dispatching it', async () => {
    const calendarId = await createCalendar('drainblocked');
    const rowId = await leaveUnprocessedRow(calendarId, {
      id: `https://${BLOCKED_HOST}/activities/left-over-create`,
      type: 'Create',
      actor: `https://${BLOCKED_HOST}/calendars/remote`,
      object: {
        id: `https://${BLOCKED_HOST}/events/left-over`,
        type: 'Event',
        attributedTo: `https://${BLOCKED_HOST}/calendars/remote`,
      },
    });

    const { domain, inboxService } = wireDomain();
    const createSpy = sandbox.spy(inboxService, 'processCreateEvent');
    stopDrain = domain.startInboxDrain();

    expect((await waitForProcessed(rowId)).processed_status).toBe('blocked');
    expect(createSpy.called).toBe(false);
  });

  it('marks a left-over row from a calendar with no follow relationship rejected', async () => {
    const calendarId = await createCalendar('drainrejected');
    const rowId = await leaveUnprocessedRow(calendarId, {
      id: 'https://stranger.example/activities/left-over-create',
      type: 'Create',
      actor: 'https://stranger.example/calendars/stranger',
      object: {
        id: 'https://stranger.example/events/left-over',
        type: 'Event',
        attributedTo: 'https://stranger.example/calendars/stranger',
      },
    });

    const { domain, inboxService } = wireDomain();
    const createSpy = sandbox.spy(inboxService, 'processCreateEvent');
    stopDrain = domain.startInboxDrain();

    expect((await waitForProcessed(rowId)).processed_status).toBe('rejected');
    expect(createSpy.called).toBe(false);
  });
});
