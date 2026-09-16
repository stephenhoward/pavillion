import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ValidationError } from '@/common/exceptions/base';
import CalendarInterface from '@/server/calendar/interface';
import AccountService from '@/server/accounts/service/account';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { IMAGE_ALT_MAX_LENGTH } from '@/server/calendar/service/image_alt';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for series content imageAlt.
 *
 * Exercises the full calendar interface -> series service -> entity -> SQLite
 * stack without mocks. Unlike events, a series has no inbound federation
 * writer — a peer's series is allow-listed down to `{ id, name, description }`
 * onto the event's `source_series` JSON and never reaches this table — so both
 * write paths here are author-facing and both reject rather than drop.
 *
 * Create and update are separate enforcement sites: the update branch bypasses
 * the createSeriesContent funnel, so every behaviour below is asserted on both.
 */
describe('Series content imageAlt — write paths (integration)', () => {
  let env: TestEnvironment;
  let calendarInterface: CalendarInterface;
  let testAccount: Account;
  let testCalendar: Calendar;
  let eventBus: EventEmitter;
  let seriesCounter = 0;

  const nextUrlName = () => `series-alt-${++seriesCounter}`;

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

    const info = await accountService._setupAccount('seriesimagealt@pavillion.dev', 'testpassword');
    testAccount = info.account;
    testCalendar = await calendarInterface.createCalendar(testAccount, 'seriesimagealtcal');
  });

  afterAll(async () => {
    if (eventBus) {
      eventBus.removeAllListeners();
    }
    await env.cleanup();
  });

  it('persists imageAlt on create and returns it on fetch', async () => {
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: {
        en: {
          name: 'Illustrated Series',
          description: 'A series with an image',
          imageAlt: 'A quartet playing in a park bandstand',
        },
      },
    });

    expect(created.content('en').imageAlt).toBe('A quartet playing in a park bandstand');

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('A quartet playing in a park bandstand');
  });

  it('keeps each language independent', async () => {
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: {
        en: { name: 'Bilingual Series', imageAlt: 'A quartet playing' },
        fr: { name: 'Série bilingue', imageAlt: 'Un quatuor qui joue' },
      },
    });

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('A quartet playing');
    expect(fetched.content('fr').imageAlt).toBe('Un quatuor qui joue');
  });

  it('leaves imageAlt empty when the author supplies none', async () => {
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'Decorative Series', description: 'No alt text' } },
    });

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('');
  });

  it('trims padding and strips markup, bidi and control characters on create', async () => {
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: {
        en: { name: 'Hostile Alt Series', imageAlt: '  <b>A quartet</b> playing‮  ' },
      },
    });

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('A quartet playing');
  });

  it('rejects an over-long imageAlt on create and writes no series', async () => {
    const urlName = nextUrlName();

    await expect(calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName,
      content: { en: { name: 'Too Much Alt', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) } },
    })).rejects.toThrow(ValidationError);

    // The pre-pass runs before the series row itself is built, so a rejected
    // create leaves no orphaned series behind holding the urlName.
    await expect(calendarInterface.getSeriesByUrlName(testCalendar.id, urlName)).rejects.toThrow();
  });

  it('rejects a non-string imageAlt on create', async () => {
    await expect(calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'Odd Alt Series', imageAlt: { en: 'nope' } } },
    })).rejects.toThrow(ValidationError);
  });

  it('updates imageAlt on an existing content row', async () => {
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'Update Alt Series', imageAlt: 'Original alt text' } },
    });

    await calendarInterface.updateSeries(testAccount, created.id, {
      content: { en: { name: 'Update Alt Series', imageAlt: 'Corrected alt text' } },
    });

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('Corrected alt text');
  });

  it('normalizes imageAlt on update as well as on create', async () => {
    // The update branch bypasses createSeriesContent, so it needs its own
    // normalization — an author correcting alt text must not be the way markup
    // reaches the column.
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'Normalize On Update Series', imageAlt: 'Original alt text' } },
    });

    await calendarInterface.updateSeries(testAccount, created.id, {
      content: { en: { name: 'Normalize On Update Series', imageAlt: '  <i>A quartet</i> playing​  ' } },
    });

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('A quartet playing');
  });

  it('clears imageAlt when an update omits it', async () => {
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'Clear Alt Series', imageAlt: 'Alt to be removed' } },
    });

    await calendarInterface.updateSeries(testAccount, created.id, {
      content: { en: { name: 'Clear Alt Series' } },
    });

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('');
  });

  it('rejects an over-long imageAlt on update and leaves the stored value alone', async () => {
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'Update Too Much Alt', imageAlt: 'Original alt text' } },
    });

    await expect(calendarInterface.updateSeries(testAccount, created.id, {
      content: { en: { name: 'Update Too Much Alt', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) } },
    })).rejects.toThrow(ValidationError);

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').imageAlt).toBe('Original alt text');
  });

  it('writes no language when a later language has an over-long imageAlt', async () => {
    // Rejection is all-or-nothing across languages. validateImageAlt throws,
    // the content loop writes one row per language, and updateSeries opens no
    // transaction — so validating inside the loop would commit the first
    // language's edit and then reject on the second, leaving half the author's
    // update saved under an error message.
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'Partial Write Series', imageAlt: 'Original alt text' } },
    });

    await expect(calendarInterface.updateSeries(testAccount, created.id, {
      content: {
        en: { name: 'Partial Write Series Renamed', imageAlt: 'Corrected alt text' },
        fr: { name: 'Série partielle', imageAlt: 'a'.repeat(IMAGE_ALT_MAX_LENGTH + 1) },
      },
    })).rejects.toThrow(ValidationError);

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('en').name).toBe('Partial Write Series');
    expect(fetched.content('en').imageAlt).toBe('Original alt text');
    // hasContent, not content(): TranslatedModel.content() lazily fabricates an
    // empty instance for a missing language, so it cannot prove absence.
    expect(fetched.hasContent('fr')).toBe(false);
  });

  it('persists imageAlt on a language an update adds for the first time', async () => {
    // The update loop has two arms and the cases above only reach the one that
    // finds an existing row. Adding a translation takes the other arm, which
    // writes through createSeriesContent.
    const created = await calendarInterface.createSeries(testAccount, testCalendar.id, {
      urlName: nextUrlName(),
      content: { en: { name: 'New Language Series', imageAlt: 'A quartet playing' } },
    });

    await calendarInterface.updateSeries(testAccount, created.id, {
      content: {
        en: { name: 'New Language Series', imageAlt: 'A quartet playing' },
        fr: { name: 'Série nouvelle langue', imageAlt: 'Un quatuor qui joue' },
      },
    });

    const fetched = await calendarInterface.getSeries(created.id);
    expect(fetched.content('fr').imageAlt).toBe('Un quatuor qui joue');
    expect(fetched.content('en').imageAlt).toBe('A quartet playing');
  });
});
