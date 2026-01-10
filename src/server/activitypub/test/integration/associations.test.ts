import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { FollowingCalendarEntity } from '@/server/activitypub/entity/activitypub';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { ActivityPubActor } from '@/server/activitypub/model/base';

describe('FollowingCalendarEntity associations', () => {
  let env: TestEnvironment;
  let testAccount: Account;
  let testCalendar: Calendar;
  let testEventId: string;
  let testFollowingId: string;
  let calendarInterface: CalendarInterface;

  beforeAll(async () => {
    // Initialize test environment with database
    env = new TestEnvironment();
    await env.init(3199); // Use unique port

    const eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // Create test account and calendar
    const accountInfo = await accountService._setupAccount('assoc-test@pavillion.dev', 'testpassword');
    testAccount = accountInfo.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'assoccalendar');

    // Create event
    const event = await calendarInterface.createEvent(testAccount, {
      calendarId: testCalendar.id,
      content: {
        en: {
          name: 'Test Event',
          description: 'Test Description',
        },
      },
      start_date: '2026-01-15',
      start_time: '10:00',
      end_date: '2026-01-15',
      end_time: '11:00',
    });
    testEventId = event.id;

    // Create following relationship
    testFollowingId = `https://example.com/follows/${uuidv4()}`;
    await FollowingCalendarEntity.create({
      id: testFollowingId,
      remote_calendar_id: 'https://remote.example.com/o/remotecal',
      calendar_id: testCalendar.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });
  });

  afterAll(async () => {
    // Clean up
    await env.cleanup();
  });

  it('should include Calendar via association', async () => {
    const following = await FollowingCalendarEntity.findOne({
      where: { id: testFollowingId },
      include: [{ model: CalendarEntity, as: 'calendar' }],
    });

    expect(following).toBeDefined();
    expect(following?.calendar).toBeDefined();
    expect(following?.calendar.id).toBe(testCalendar.id);
    expect(following?.calendar.url_name).toBe('assoccalendar');
  });

  it('should traverse from FollowingCalendar to Calendar to Events', async () => {
    // First, get the following with calendar
    const following = await FollowingCalendarEntity.findOne({
      where: { id: testFollowingId },
      include: [{
        model: CalendarEntity,
        as: 'calendar',
      }],
    });

    expect(following).toBeDefined();
    expect(following?.calendar).toBeDefined();

    // Events store calendar_id as ActivityPub URL (https://domain/o/urlName), not UUID
    // So we need to query events using the calendar's AP identifier
    const calendarApUrl = ActivityPubActor.actorUrl(testCalendar);
    const events = await EventEntity.findAll({
      where: { calendar_id: calendarApUrl },
      include: [{
        model: EventContentEntity,
        as: 'content',
      }],
    });

    expect(events).toBeDefined();
    expect(events.length).toBeGreaterThan(0);

    const event = events[0];
    expect(event.id).toBe(testEventId);
    expect(event.content).toBeDefined();
    expect(event.content.length).toBeGreaterThan(0);
    expect(event.content[0].name).toBe('Test Event');
  });

  it('should support querying all followings with their calendars and events', async () => {
    const followings = await FollowingCalendarEntity.findAll({
      where: { calendar_id: testCalendar.id },
      include: [{
        model: CalendarEntity,
        as: 'calendar',
        include: [{
          model: EventEntity,
          as: 'events',
        }],
      }],
    });

    expect(followings).toBeDefined();
    expect(followings.length).toBeGreaterThan(0);

    // Verify the association chain works
    const following = followings[0];
    expect(following.calendar).toBeDefined();
    expect(following.calendar.events).toBeDefined();
  });

  it('should handle empty event lists gracefully', async () => {
    // Create a calendar with no events
    const emptyCalendar = await calendarInterface.createCalendar(testAccount, 'emptycalendar');
    const emptyFollowingId = `https://example.com/follows/${uuidv4()}`;

    await FollowingCalendarEntity.create({
      id: emptyFollowingId,
      remote_calendar_id: 'https://remote.example.com/o/emptycal',
      calendar_id: emptyCalendar.id,
      auto_repost_originals: false,
      auto_repost_reposts: false,
    });

    const following = await FollowingCalendarEntity.findOne({
      where: { id: emptyFollowingId },
      include: [{
        model: CalendarEntity,
        as: 'calendar',
        include: [{
          model: EventEntity,
          as: 'events',
        }],
      }],
    });

    expect(following).toBeDefined();
    expect(following?.calendar).toBeDefined();
    expect(following?.calendar.events).toBeDefined();
    expect(following?.calendar.events.length).toBe(0);
  });
});
