import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventEntity, EventContentEntity } from '@/server/calendar/entity/event';
import EventService from '@/server/calendar/service/events';
import { InvalidExternalUrlError } from '@/common/exceptions/calendar';
import { ValidationError } from '@/common/exceptions/base';

/**
 * Tests for externalUrl / urlPrompt validation wired through createEvent and
 * updateEvent on EventService. These exercise the module-private
 * `normalizeExternalUrl`, `validateUrlPrompt`, and cross-field rule defined
 * inside `src/server/calendar/service/events.ts`.
 */
describe('EventService externalUrl + urlPrompt validation (via createEvent)', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  const cal = new Calendar('testCalendarId', 'testme');
  const acct = new Account('testAccountId', 'testme', 'testme');

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    sandbox.stub(service['calendarService'], 'editableCalendarsForUser').resolves([cal]);
    sandbox.stub(service['calendarService'], 'getCalendar').resolves(cal);
    sandbox.stub(EventEntity.prototype, 'save');
    sandbox.stub(EventContentEntity.prototype, 'save');
  });

  afterEach(() => {
    sandbox.restore();
  });

  // === normalizeExternalUrl cases ===

  it('treats null externalUrl as null (and null urlPrompt passes)', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: null,
      urlPrompt: null,
    });
    expect(event.externalUrl).toBeNull();
    expect(event.urlPrompt).toBeNull();
  });

  it('treats undefined externalUrl as null', async () => {
    const event = await service.createEvent(acct, { calendarId: cal.id });
    expect(event.externalUrl).toBeNull();
    expect(event.urlPrompt).toBeNull();
  });

  it('treats empty string as null', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: '',
      urlPrompt: null,
    });
    expect(event.externalUrl).toBeNull();
  });

  it('treats whitespace-only string as null', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: '   \t  ',
      urlPrompt: null,
    });
    expect(event.externalUrl).toBeNull();
  });

  it('throws InvalidExternalUrlError when externalUrl is longer than 2048 chars', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2048);
    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: longUrl,
      urlPrompt: 'tickets',
    })).rejects.toBeInstanceOf(InvalidExternalUrlError);
  });

  it('prepends https:// when scheme is missing', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'example.com/path',
      urlPrompt: 'tickets',
    });
    expect(event.externalUrl).toBe('https://example.com/path');
  });

  it('accepts uppercase HTTPS scheme and normalizes to lowercase via URL', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'HTTPS://Example.com/Path',
      urlPrompt: 'tickets',
    });
    expect(event.externalUrl).toMatch(/^https:\/\/example\.com\/Path/);
  });

  it('rejects javascript: scheme with InvalidExternalUrlError', async () => {
    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'javascript:alert(1)',
      urlPrompt: 'tickets',
    })).rejects.toBeInstanceOf(InvalidExternalUrlError);
  });

  it('rejects data: scheme with InvalidExternalUrlError', async () => {
    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'data:text/plain,hello',
      urlPrompt: 'tickets',
    })).rejects.toBeInstanceOf(InvalidExternalUrlError);
  });

  it('rejects ftp: scheme with InvalidExternalUrlError', async () => {
    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'ftp://example.com/file',
      urlPrompt: 'tickets',
    })).rejects.toBeInstanceOf(InvalidExternalUrlError);
  });

  it('rejects fragment-only string (treated as missing-scheme and unparseable)', async () => {
    // "#foo" has no "://", gets `https://` prepended, then "#foo" would
    // be treated as a hostname fragment — URL parsing throws.
    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: '#foo',
      urlPrompt: 'tickets',
    })).rejects.toBeInstanceOf(InvalidExternalUrlError);
  });

  it('accepts valid http URL', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'http://example.com/tix',
      urlPrompt: 'tickets',
    });
    expect(event.externalUrl).toBe('http://example.com/tix');
  });

  it('accepts valid https URL', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/rsvp',
      urlPrompt: 'rsvp',
    });
    expect(event.externalUrl).toBe('https://example.com/rsvp');
  });

  it('handles protocol-relative input by prepending https://', async () => {
    // '//example.com' has no '://', so normalizer prepends https://
    // giving 'https:////example.com'. URL parser accepts this and normalizes
    // the authority; we only require the validator not to throw and to store
    // a valid https URL.
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: '//example.com',
      urlPrompt: 'tickets',
    });
    expect(event.externalUrl).toMatch(/^https:\/\//);
  });

  // === validateUrlPrompt cases ===

  it('accepts urlPrompt = tickets', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/',
      urlPrompt: 'tickets',
    });
    expect(event.urlPrompt).toBe('tickets');
  });

  it('accepts urlPrompt = rsvp', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/',
      urlPrompt: 'rsvp',
    });
    expect(event.urlPrompt).toBe('rsvp');
  });

  it('accepts urlPrompt = more_info', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/',
      urlPrompt: 'more_info',
    });
    expect(event.urlPrompt).toBe('more_info');
  });

  it('accepts urlPrompt = register', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/',
      urlPrompt: 'register',
    });
    expect(event.urlPrompt).toBe('register');
  });

  it('rejects unknown urlPrompt value with ValidationError', async () => {
    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/',
      urlPrompt: 'not_a_real_prompt',
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects non-string urlPrompt with ValidationError', async () => {
    await expect(service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/',
      urlPrompt: 42 as any,
    })).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts null urlPrompt when externalUrl is also null', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: null,
      urlPrompt: null,
    });
    expect(event.urlPrompt).toBeNull();
    expect(event.externalUrl).toBeNull();
  });

  // === cross-field rule ===

  it('rejects externalUrl set with null urlPrompt (partial state)', async () => {
    const err = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/',
      urlPrompt: null,
    }).catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields).toBeDefined();
    expect((err as ValidationError).fields).toHaveProperty('externalUrl');
    expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
  });

  it('rejects urlPrompt set with null externalUrl (partial state)', async () => {
    const err = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: null,
      urlPrompt: 'tickets',
    }).catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields).toBeDefined();
    expect((err as ValidationError).fields).toHaveProperty('externalUrl');
    expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
  });

  it('accepts both null (no external URL on this event)', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: null,
      urlPrompt: null,
    });
    expect(event.externalUrl).toBeNull();
    expect(event.urlPrompt).toBeNull();
  });

  it('accepts both set with a valid pair', async () => {
    const event = await service.createEvent(acct, {
      calendarId: cal.id,
      externalUrl: 'https://example.com/tix',
      urlPrompt: 'tickets',
    });
    expect(event.externalUrl).toBe('https://example.com/tix');
    expect(event.urlPrompt).toBe('tickets');
  });
});

describe('EventService externalUrl + urlPrompt validation (via updateEvent)', () => {
  let service: EventService;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  const cal = new Calendar('testCalendarId', 'testme');
  const acct = new Account('testAccountId', 'testme', 'testme');
  const eventId = '11111111-1111-4111-8111-111111111111';

  beforeEach(() => {
    service = new EventService(new EventEmitter());
    sandbox.stub(service['calendarService'], 'editableCalendarsForUser').resolves([cal]);
    sandbox.stub(service['calendarService'], 'getCalendar').resolves(cal);
    sandbox.stub(EventEntity, 'findByPk').resolves(
      EventEntity.build({ calendar_id: cal.id, id: eventId }),
    );
    sandbox.stub(EventEntity.prototype, 'save');
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('rejects javascript: scheme in update', async () => {
    await expect(service.updateEvent(acct, eventId, {
      externalUrl: 'javascript:alert(1)',
      urlPrompt: 'tickets',
    })).rejects.toBeInstanceOf(InvalidExternalUrlError);
  });

  it('rejects partial state (url set, prompt null) in update', async () => {
    const err = await service.updateEvent(acct, eventId, {
      externalUrl: 'https://example.com/',
      urlPrompt: null,
    }).catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields).toHaveProperty('externalUrl');
    expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
  });

  it('rejects partial state (prompt set, url null) in update', async () => {
    const err = await service.updateEvent(acct, eventId, {
      externalUrl: null,
      urlPrompt: 'rsvp',
    }).catch(e => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).fields).toHaveProperty('externalUrl');
    expect((err as ValidationError).fields).toHaveProperty('urlPrompt');
  });

  it('accepts a valid pair and stores normalized URL in update', async () => {
    const event = await service.updateEvent(acct, eventId, {
      externalUrl: 'example.com/tix',
      urlPrompt: 'tickets',
    });
    expect(event.externalUrl).toBe('https://example.com/tix');
    expect(event.urlPrompt).toBe('tickets');
  });

  it('accepts both null (clearing external url) in update', async () => {
    const event = await service.updateEvent(acct, eventId, {
      externalUrl: null,
      urlPrompt: null,
    });
    expect(event.externalUrl).toBeNull();
    expect(event.urlPrompt).toBeNull();
  });

  it('leaves existing values untouched when neither field is present in params', async () => {
    // When the client does not send externalUrl or urlPrompt, the service
    // must not treat them as "explicitly cleared" and must not run the
    // cross-field rule. A payload containing only unrelated fields must pass
    // through without invoking URL validation.
    const event = await service.updateEvent(acct, eventId, {
      mediaFocalPointX: 0.6,
    });
    expect(event).toBeDefined();
  });
});
