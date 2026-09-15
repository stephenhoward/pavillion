import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import CalendarService from '@/server/calendar/service/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';

/**
 * Creates a calendar row directly, bypassing url-name validation.
 *
 * Collisions are a property of already-stored data — a row may predate the
 * reserved list — so the fixture writes the entity rather than going through
 * CalendarService.createCalendar.
 *
 * Some of the seeded names are deliberately synthetic rather than plausible
 * history: a two-character locale code such as 'es' was never reachable
 * through a validated write, since CALENDAR_URL_NAME_RE has enforced a
 * three-character minimum for the whole life of the rule. The check still has
 * to cover it, because a hand-edited row, a restored dump, or a future locale
 * code long enough to pass the charset rule would all land here.
 */
async function seedCalendar(urlName: string): Promise<void> {
  await CalendarEntity.create({
    id: uuidv4(),
    url_name: urlName,
    languages: 'en',
  });
}

describe('CalendarService.findReservedUrlNameCollisions', () => {
  let service: CalendarService;

  beforeEach(async () => {
    await db.sync({ force: true });
    service = new CalendarService();
  });

  afterEach(async () => {
    await CalendarEntity.destroy({ where: {}, force: true });
  });

  it('returns an empty array when no calendar exists', async () => {
    expect(await service.findReservedUrlNameCollisions()).toEqual([]);
  });

  it('does not report calendars whose url names are not reserved', async () => {
    await seedCalendar('community-events');
    await seedCalendar('administrators');

    expect(await service.findReservedUrlNameCollisions()).toEqual([]);
  });

  it('reports a calendar whose url name is a reserved route segment', async () => {
    await seedCalendar('admin');
    await seedCalendar('community-events');

    expect(await service.findReservedUrlNameCollisions())
      .toEqual([{ urlName: 'admin', reason: 'reserved_segment' }]);
  });

  it('reports a calendar whose url name is a supported locale code', async () => {
    await seedCalendar('es');
    await seedCalendar('community-events');

    expect(await service.findReservedUrlNameCollisions())
      .toEqual([{ urlName: 'es', reason: 'locale_code' }]);
  });

  it('reports a reserved url name stored in mixed case', async () => {
    await seedCalendar('Admin');

    expect(await service.findReservedUrlNameCollisions())
      .toEqual([{ urlName: 'Admin', reason: 'reserved_segment' }]);
  });

  it('reports every colliding calendar with its own reason, sorted by url name', async () => {
    await seedCalendar('view');
    await seedCalendar('admin');
    await seedCalendar('community-events');
    await seedCalendar('fr');

    expect(await service.findReservedUrlNameCollisions()).toEqual([
      { urlName: 'admin', reason: 'reserved_segment' },
      { urlName: 'fr', reason: 'locale_code' },
      { urlName: 'view', reason: 'reserved_segment' },
    ]);
  });

  it('leaves the colliding calendars in place', async () => {
    await seedCalendar('admin');

    await service.findReservedUrlNameCollisions();

    const stored = await CalendarEntity.findAll({ attributes: ['url_name'] });
    expect(stored.map(calendar => calendar.url_name)).toEqual(['admin']);
  });
});
