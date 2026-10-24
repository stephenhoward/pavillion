import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import sinon from 'sinon';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import ProcessInboxService from '@/server/activitypub/service/inbox';
import CreateActivity from '@/server/activitypub/model/action/create';
import UpdateActivity from '@/server/activitypub/model/action/update';
import { EventObject } from '@/server/activitypub/model/object/event';
import { EventEntity } from '@/server/calendar/entity/event';
import { MediaEntity } from '@/server/media/entity/media';
import { IMAGE_ALT_MAX_LENGTH } from '@/server/calendar/service/image_alt';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the remote-editor envelope (`object.eventParams` on a
 * Person-actor Create or Update).
 *
 * End-to-end path:
 *
 *   Person-actor Create/Update carrying an envelope
 *     -- ProcessInboxService.processCreateEvent / processUpdateEvent -->
 *        EventObject.parseRemoteEditorParams (strip markup, close key set)
 *     -- calendarInterface.addRemoteEvent / updateRemoteEvent -->
 *        sanitizeImageAlt (the calendar domain's length cap)
 *     -- real SQLite rows
 *
 * The Person-actor classification and the editor-membership lookup are
 * stubbed; everything downstream of them is real.
 */
describe('Remote-editor envelope — inbound sanitization (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let inboxService: ProcessInboxService;
  let testAccount: Account;
  let calendar: Calendar;
  let eventBus: EventEmitter;
  let sandbox: sinon.SinonSandbox;

  const editorUri = 'https://editor.example/users/alice';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    eventBus = new EventEmitter();
    calendarInterface = new CalendarInterface(eventBus);
    calendarInterface.setActivityPubInterface({
      getSharedEventStatusMap: async () => new Map(),
      findCalendarActorByCalendarId: async () => null,
    } as any);

    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    const info = await accountService._setupAccount('remote-editor-envelope@pavillion.dev', 'testpassword');
    testAccount = info.account;
    calendar = await calendarInterface.createCalendar(testAccount, 'remoteeditorenvelope');

    inboxService = new ProcessInboxService(eventBus, calendarInterface);
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  function asAuthorizedEditor() {
    sandbox.stub(inboxService as any, 'isPersonActorUri').resolves(true);
    sandbox.stub(inboxService as any, 'isAuthorizedRemoteEditor').resolves(true);
  }

  /** Person-actor Create carrying `envelope`; returns the stored event's id. */
  async function editorCreate(apObjectId: string, envelope: Record<string, any>): Promise<string> {
    const created = await inboxService.processCreateEvent(calendar, CreateActivity.fromObject({
      type: 'Create',
      actor: editorUri,
      object: { type: 'Event', id: apObjectId, name: 'Remote Event', attributedTo: editorUri, eventParams: envelope },
    })!);
    expect(created).not.toBeNull();
    return created!.id;
  }

  async function editorUpdate(apObjectId: string, eventId: string, envelope: Record<string, any>): Promise<void> {
    const updated = await inboxService.processUpdateEvent(calendar, UpdateActivity.fromObject({
      type: 'Update',
      actor: editorUri,
      object: {
        type: 'Event',
        id: apObjectId,
        name: 'Remote Event',
        attributedTo: editorUri,
        eventParams: { ...envelope, id: eventId },
      },
    })!);
    expect(updated).not.toBeNull();
  }

  describe('imageAlt length cap', () => {
    it('drops an over-long imageAlt on a Person-actor Create and keeps the rest of the row', async () => {
      asAuthorizedEditor();
      const eventId = await editorCreate(`https://editor.example/events/${uuidv4()}`, {
        content: { en: { name: 'Remote Event', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) } },
      });

      const stored = await calendarInterface.getEventById(eventId);
      expect(stored.content('en').name).toBe('Remote Event');
      expect(stored.content('en').imageAlt).toBe('');
    });

    it('keeps an imageAlt at the cap on a Person-actor Create', async () => {
      asAuthorizedEditor();
      const eventId = await editorCreate(`https://editor.example/events/${uuidv4()}`, {
        content: { en: { name: 'Remote Event', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH) } },
      });

      const stored = await calendarInterface.getEventById(eventId);
      expect(stored.content('en').imageAlt).toBe('a'.repeat(IMAGE_ALT_MAX_LENGTH));
    });

    it('drops an over-long imageAlt on a Person-actor Update and keeps the rest of the row', async () => {
      asAuthorizedEditor();
      const apObjectId = `https://editor.example/events/${uuidv4()}`;
      const eventId = await editorCreate(apObjectId, {
        content: { en: { name: 'Remote Event', imageAlt: 'Original alt' } },
      });

      await editorUpdate(apObjectId, eventId, {
        content: { en: { name: 'Remote Event Renamed', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) } },
      });

      const stored = await calendarInterface.getEventById(eventId);
      expect(stored.content('en').name).toBe('Remote Event Renamed');
      expect(stored.content('en').imageAlt).toBe('');
    });

    it('keeps an imageAlt at the cap on a Person-actor Update', async () => {
      asAuthorizedEditor();
      const apObjectId = `https://editor.example/events/${uuidv4()}`;
      const eventId = await editorCreate(apObjectId, {
        content: { en: { name: 'Remote Event', imageAlt: 'Original alt' } },
      });

      await editorUpdate(apObjectId, eventId, {
        content: { en: { name: 'Remote Event', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH) } },
      });

      const stored = await calendarInterface.getEventById(eventId);
      expect(stored.content('en').imageAlt).toBe('a'.repeat(IMAGE_ALT_MAX_LENGTH));
    });
  });

  it('stores a Person-actor Update description without markup and re-emits none', async () => {
    asAuthorizedEditor();
    const apObjectId = `https://editor.example/events/${uuidv4()}`;
    const eventId = await editorCreate(apObjectId, {
      content: { en: { name: 'Remote Event', description: 'Plain' } },
    });

    await editorUpdate(apObjectId, eventId, {
      content: { en: { name: 'Remote Event', description: '<script>alert(1)</script><b>Bold</b> text' } },
    });

    const stored = await calendarInterface.getEventById(eventId);
    expect(stored.content('en').description).toBe('alert(1)Bold text');

    const emitted = new EventObject(calendar, stored).toActivityPubObject();
    expect(emitted.summary).toBe('alert(1)Bold text');
    expect(emitted.content).not.toMatch(/<script|<b>/i);
  });

  it('never links a Person-actor Create to a local media or series row named in the envelope', async () => {
    const media = await MediaEntity.create({
      id: uuidv4(),
      account_id: testAccount.id,
      calendar_id: calendar.id,
      original_filename: 'local.jpg',
      storage_path: '/test/local.jpg',
      mime_type: 'image/jpeg',
      file_size: 1024,
      sha256: `remote-editor-envelope-${uuidv4()}`,
    });
    const series = await calendarInterface.createSeries(testAccount, calendar.id, {
      urlName: 'localseries',
      content: { en: { name: 'Local Series', description: '' } },
    });

    asAuthorizedEditor();
    const eventId = await editorCreate(`https://editor.example/events/${uuidv4()}`, {
      content: { en: { name: 'Remote Event' } },
      media: { id: media.id },
      mediaId: media.id,
      series: { id: series.id },
    });

    const row = await EventEntity.findByPk(eventId);
    expect(row).not.toBeNull();
    expect(row!.media_id).toBeNull();
    expect(row!.series_id).toBeNull();
  });
});
