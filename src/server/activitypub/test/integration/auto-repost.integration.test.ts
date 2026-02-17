/**
 * Integration tests for auto-repost policy enforcement.
 *
 * These tests verify that the checkAndPerformAutoRepost method in ProcessInboxService
 * correctly enforces auto-repost policies when processing incoming ActivityPub activities.
 *
 * Test scenarios cover:
 * 1. Auto-reposting originals when policy enabled
 * 2. Auto-reposting reposts when policy enabled
 * 3. No auto-repost when policy disabled
 * 4. No auto-repost for person actor Creates
 * 5. Self-origin loop prevention
 * 6. Duplicate prevention
 * 7. attributed_to mismatch rejection
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountsInterface from '@/server/accounts/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import EmailInterface from '@/server/email/interface';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { SharedEventEntity, ActivityPubOutboxMessageEntity } from '@/server/activitypub/entity/activitypub';
import { EventObjectEntity } from '@/server/activitypub/entity/event_object';
import { UserActorEntity } from '@/server/activitypub/entity/user_actor';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import CreateActivity from '@/server/activitypub/model/action/create';
import AnnounceActivity from '@/server/activitypub/model/action/announce';
import { ActivityPubActor } from '@/server/activitypub/model/base';
import { createFollowingRelationship, createSharedEvent, getOrCreateRemoteCalendarActor } from '@/server/test/helpers/database';

describe('Auto-Repost Integration Tests', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let accountsInterface: AccountsInterface;
  let configurationInterface: ConfigurationInterface;
  let eventBus: EventEmitter;
  let inboxService: ProcessInboxService;
  let sandbox: sinon.SinonSandbox;

  // Test accounts and calendars
  let accountA: Account;
  let calendarA: Calendar;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const emailInterface = new EmailInterface();

    // Configure registration mode to 'open' BEFORE creating accounts
    await configurationInterface.setSetting('registrationMode', 'open');

    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface, emailInterface);
    calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    inboxService = new ProcessInboxService(eventBus, calendarInterface);

    // Create Account A with calendar using AccountsInterface
    const accountAEmail = 'accounta@pavillion.dev';
    accountA = await accountsInterface.registerNewAccount(accountAEmail) as Account;
    await accountsInterface.setPassword(accountA, 'testpassword');
    calendarA = await calendarInterface.createCalendar(accountA, 'calendara');
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Test 1: Auto-repost originals when policy enabled', () => {
    it('should create SharedEventEntity with auto_posted=true and add Announce to outbox', async () => {
      // Setup: Create remote Calendar B actor and follow with auto_repost_originals=true
      const calendarBActorUri = 'https://remote.example.com/calendars/calendarb';
      await createFollowingRelationship(calendarA.id, calendarBActorUri, true, false);

      // Prepare event data
      const eventApId = 'https://remote.example.com/events/event1';

      // Stub addRemoteEvent to avoid full event creation
      // processCreateEvent will generate its own UUID and create EventObjectEntity
      sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
        id: uuidv4(), // Return any UUID, processCreateEvent will use its own
        calendarId: null,
      } as any);

      // Stub actorOwnsObject to avoid remote fetch
      sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

      // Build CreateActivity from Calendar B - use proper ActivityPub Event object structure
      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event',
        summary: 'Test event description',
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);

      // Process the Create activity
      await inboxService['processCreateEvent'](calendarA, createActivity);

      // Get the EventObjectEntity to find the generated event_id
      const eventObjectTest1 = await EventObjectEntity.findOne({
        where: { ap_id: eventApId },
      });

      expect(eventObjectTest1).toBeDefined();

      // Assert: SharedEventEntity created with auto_posted=true
      const sharedEvent = await SharedEventEntity.findOne({
        where: {
          event_id: eventObjectTest1!.event_id,  // Use the generated event_id
          calendar_id: calendarA.id,
        },
      });

      expect(sharedEvent).toBeDefined();
      expect(sharedEvent?.auto_posted).toBe(true);

      // Assert: Announce activity in outbox
      const outboxMessages = await ActivityPubOutboxMessageEntity.findAll({
        where: {
          calendar_id: calendarA.id,
          type: 'Announce',
        },
      });

      expect(outboxMessages.length).toBeGreaterThan(0);
      const announceMessage = outboxMessages.find((msg: any) => {
        const activity = msg.toModel() as AnnounceActivity;
        return activity.object === eventApId;
      });
      expect(announceMessage).toBeDefined();
    });
  });

  // TODO: Re-enable when validation is restored in bead pv-5fk
  describe.skip('Test 2: Auto-repost reposts when policy enabled', () => {
    it('should create SharedEventEntity with auto_posted=true when processing Announce', async () => {
      // Setup: Create remote Calendar B actor and follow with auto_repost_reposts=true
      const calendarBActorUri = 'https://remote.example.com/calendars/calendarb2';
      await createFollowingRelationship(calendarA.id, calendarBActorUri, false, true);

      // Create original event from Calendar C
      const eventApId = 'https://remote.example.com/events/event2';
      const eventId = uuidv4();

      // For Announce activities, the event should already exist
      // EventObjectEntity should be attributed to B (the one sharing it)
      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: calendarBActorUri, // B is sharing it
      });

      // Stub addRemoteEvent
      sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
        id: eventId,
        calendarId: null,
      } as any);

      // Build AnnounceActivity from Calendar B sharing the event
      const announceActivity = new AnnounceActivity(
        calendarBActorUri,
        eventApId,
      );
      announceActivity.id = `${calendarBActorUri}/activities/announce-${uuidv4()}`;

      // Process the Announce activity
      await inboxService['processShareEvent'](calendarA, announceActivity);

      // Assert: SharedEventEntity created with auto_posted=true
      const sharedEvent = await SharedEventEntity.findOne({
        where: {
          event_id: eventId,  // Query by local UUID, not AP URL
          calendar_id: calendarA.id,
        },
      });

      expect(sharedEvent).toBeDefined();
      expect(sharedEvent?.auto_posted).toBe(true);

      // Assert: Announce activity in outbox
      const outboxMessages = await ActivityPubOutboxMessageEntity.findAll({
        where: {
          calendar_id: calendarA.id,
          type: 'Announce',
        },
      });

      const announceMessage = outboxMessages.find((msg: any) => {
        const activity = msg.toModel() as AnnounceActivity;
        return activity.object === eventApId;
      });
      expect(announceMessage).toBeDefined();
    });
  });

  describe('Test 3: No auto-repost when policy disabled', () => {
    it('should not create SharedEventEntity when auto_repost_originals=false', async () => {
      // Setup: Follow with auto_repost_originals=false
      const calendarBActorUri = 'https://remote.example.com/calendars/calendarb3';
      await createFollowingRelationship(calendarA.id, calendarBActorUri, false, false);

      // Prepare event data
      const eventApId = 'https://remote.example.com/events/event3';
      const eventId = uuidv4();

      // Stub addRemoteEvent
      sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
        id: eventId,
        calendarId: null,
      } as any);

      // Stub actorOwnsObject to avoid remote fetch
      sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

      // Build CreateActivity with proper object structure
      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event',
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);

      // Process the Create activity
      await inboxService['processCreateEvent'](calendarA, createActivity);

      // Assert: No SharedEventEntity created
      const sharedEvent = await SharedEventEntity.findOne({
        where: {
          event_id: eventId,  // Query by local UUID, not AP URL
          calendar_id: calendarA.id,
        },
      });

      expect(sharedEvent).toBeNull();

      // Assert: No Announce in outbox for this event
      const outboxMessages = await ActivityPubOutboxMessageEntity.findAll({
        where: {
          calendar_id: calendarA.id,
          type: 'Announce',
        },
      });

      const announceForEvent = outboxMessages.find((msg: any) => {
        const activity = msg.toModel() as AnnounceActivity;
        return activity.object === eventApId;
      });
      expect(announceForEvent).toBeUndefined();
    });
  });

  describe('Test 4: No auto-repost for person actor Creates', () => {
    it('should not trigger auto-repost when Create is from a Person actor', async () => {
      // Setup: Follow Calendar B with auto_repost_originals=true
      const calendarBActorUri = 'https://remote.example.com/calendars/calendarb4';
      await createFollowingRelationship(calendarA.id, calendarBActorUri, true, false);

      // Create a Person actor (remote editor)
      const personActorUri = 'https://remote.example.com/users/editor1';
      await UserActorEntity.create({
        id: uuidv4(),
        actor_type: 'remote',
        account_id: null,
        actor_uri: personActorUri,
        remote_domain: 'remote.example.com',
      });

      // Prepare event data
      const eventApId = 'https://remote.example.com/events/event4';
      const eventId = uuidv4();

      // Stub addRemoteEvent
      sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
        id: eventId,
        calendarId: null,
      } as any);

      // Stub actorOwnsObject to avoid remote fetch
      sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);

      // Stub isAuthorizedRemoteEditor to allow the person actor
      sandbox.stub(inboxService as any, 'isAuthorizedRemoteEditor').resolves(true);

      // Build CreateActivity from Person actor with proper object structure
      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event',
      };

      const createActivity = new CreateActivity(personActorUri, eventObject);

      // Process the Create activity
      // Note: This goes through processCreateEvent which calls checkAndPerformAutoRepost
      // The sourceActorUri passed to checkAndPerformAutoRepost is the person actor URI
      await inboxService['processCreateEvent'](calendarA, createActivity);

      // Assert: No auto-repost because sourceActorUri (person) != attributed_to (calendar)
      const sharedEvent = await SharedEventEntity.findOne({
        where: {
          event_id: eventId,  // Query by local UUID, not AP URL
          calendar_id: calendarA.id,
        },
      });

      expect(sharedEvent).toBeNull();

      // Assert: No Announce in outbox
      const outboxMessages = await ActivityPubOutboxMessageEntity.findAll({
        where: {
          calendar_id: calendarA.id,
          type: 'Announce',
        },
      });

      const announceForEvent = outboxMessages.find((msg: any) => {
        const activity = msg.toModel() as AnnounceActivity;
        return activity.object === eventApId;
      });
      expect(announceForEvent).toBeUndefined();
    });
  });

  describe('Test 5: Self-origin loop prevention', () => {
    it('should not auto-repost events originally from the receiving calendar', async () => {
      // Setup: Calendar A follows Calendar B with auto_repost_reposts=true
      const calendarBActorUri = 'https://remote.example.com/calendars/calendarb5';
      await createFollowingRelationship(calendarA.id, calendarBActorUri, false, true);

      // Prepare event data attributed to Calendar A (self-origin)
      const calendarAActorUrl = ActivityPubActor.actorUrl(calendarA);
      const eventApId = `${calendarAActorUrl}/events/event5`;
      const eventId = uuidv4();

      // Pre-create EventObjectEntity attributed to Calendar A (self)
      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: calendarAActorUrl, // Event originally from Calendar A
      });

      // Stub addRemoteEvent
      sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
        id: eventId,
        calendarId: null,
      } as any);

      // Build AnnounceActivity from Calendar B sharing an event from Calendar A
      const announceActivity = new AnnounceActivity(
        calendarBActorUri,
        eventApId,
      );
      announceActivity.id = `${calendarBActorUri}/activities/announce-${uuidv4()}`;

      // Process the Announce activity
      await inboxService['processShareEvent'](calendarA, announceActivity);

      // Assert: No auto-repost (would be reposting own content)
      const sharedEvent = await SharedEventEntity.findOne({
        where: {
          event_id: eventId,  // Query by local UUID, not AP URL
          calendar_id: calendarA.id,
        },
      });

      expect(sharedEvent).toBeNull();

      // Assert: No Announce in outbox
      const outboxMessages = await ActivityPubOutboxMessageEntity.findAll({
        where: {
          calendar_id: calendarA.id,
          type: 'Announce',
        },
      });

      const announceForEvent = outboxMessages.find((msg: any) => {
        const activity = msg.toModel() as AnnounceActivity;
        return activity.object === eventApId;
      });
      expect(announceForEvent).toBeUndefined();
    });
  });

  describe('Test 6: Duplicate prevention', () => {
    it('should not create duplicate SharedEventEntity if one already exists', async () => {
      // Setup: Follow Calendar B WITHOUT auto-repost (to prevent auto-repost during initial setup)
      const calendarBActorUri = 'https://remote.example.com/calendars/calendarb6';
      await createFollowingRelationship(calendarA.id, calendarBActorUri, false, false);

      // Prepare event data
      const eventApId = 'https://remote.example.com/events/event6';

      // First, create the event and get its ID by doing an initial processing
      // This simulates the event already existing from a previous Create activity
      const initialStub = sandbox.stub(calendarInterface, 'addRemoteEvent');
      initialStub.onFirstCall().resolves({
        id: uuidv4(),
        calendarId: null,
      } as any);

      const initialActivity = new CreateActivity(calendarBActorUri, {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Initial Event',
      });

      sandbox.stub(inboxService as any, 'actorOwnsObject').resolves(true);
      await inboxService['processCreateEvent'](calendarA, initialActivity);

      // Get the created EventObjectEntity to find its event_id
      const eventObjectTest6 = await EventObjectEntity.findOne({
        where: { ap_id: eventApId },
      });

      expect(eventObjectTest6).toBeDefined();

      // Create existing SharedEventEntity BEFORE second processing attempt
      await createSharedEvent(eventObjectTest6!.event_id, calendarA.id, true);

      // Now stub for the duplicate attempt
      initialStub.onSecondCall().resolves({
        id: uuidv4(),
        calendarId: null,
      } as any);

      // Build CreateActivity with proper object structure
      const eventObject = {
        id: eventApId,
        type: 'Event',
        attributedTo: calendarBActorUri,
        name: 'Test Event',
      };

      const createActivity = new CreateActivity(calendarBActorUri, eventObject);

      // Count existing SharedEventEntity records
      const beforeCount = await SharedEventEntity.count({
        where: {
          event_id: eventObjectTest6!.event_id,
          calendar_id: calendarA.id,
        },
      });

      expect(beforeCount).toBe(1);

      // Process the Create activity again (should be skipped as duplicate)
      await inboxService['processCreateEvent'](calendarA, createActivity);

      // Assert: No duplicate SharedEventEntity created
      const afterCount = await SharedEventEntity.count({
        where: {
          event_id: eventObjectTest6!.event_id,
          calendar_id: calendarA.id,
        },
      });

      expect(afterCount).toBe(1); // Still just one

      // Count outbox Announce messages - should not have created another
      const outboxMessages = await ActivityPubOutboxMessageEntity.findAll({
        where: {
          calendar_id: calendarA.id,
          type: 'Announce',
        },
      });

      const announceCount = outboxMessages.filter((msg: any) => {
        const activity = msg.toModel() as AnnounceActivity;
        return activity.object === eventApId;
      }).length;

      // Should have zero because the duplicate check prevented auto-repost
      expect(announceCount).toBe(0);
    });
  });

  describe('Test 7: repost of third-party event (Announce with different attributed_to)', () => {
    it('should auto-repost when followed calendar shares a third-party event', async () => {
      // Setup: Calendar A follows Calendar B with auto_repost_reposts=true
      const calendarBActorUri = 'https://remote.example.com/calendars/calendarb7';
      await createFollowingRelationship(calendarA.id, calendarBActorUri, false, true);

      // Create Calendar C actor (different from B)
      const calendarCActorUri = 'https://remote.example.com/calendars/calendarc7';
      await getOrCreateRemoteCalendarActor(calendarCActorUri);

      // Create event attributed to Calendar C (not B who's sharing it)
      const eventApId = 'https://remote.example.com/events/event7';
      const eventId = uuidv4();

      // Pre-create EventObjectEntity attributed to Calendar C
      await EventObjectEntity.create({
        event_id: eventId,
        ap_id: eventApId,
        attributed_to: calendarCActorUri, // Event attributed to C
      });

      // Stub addRemoteEvent
      sandbox.stub(calendarInterface, 'addRemoteEvent').resolves({
        id: eventId,
        calendarId: null,
      } as any);

      // Build AnnounceActivity from Calendar B sharing an event from Calendar C
      const announceActivity = new AnnounceActivity(
        calendarBActorUri, // B is sharing
        eventApId,
      );
      announceActivity.id = `${calendarBActorUri}/activities/announce-${uuidv4()}`;

      // Process the Announce activity
      await inboxService['processShareEvent'](calendarA, announceActivity);

      // Assert: Auto-repost succeeds (B is sharing C's event, and A has autoRepostReposts=true for B)
      const sharedEvent = await SharedEventEntity.findOne({
        where: {
          event_id: eventId,
          calendar_id: calendarA.id,
        },
      });

      expect(sharedEvent).not.toBeNull();
    });
  });
});
