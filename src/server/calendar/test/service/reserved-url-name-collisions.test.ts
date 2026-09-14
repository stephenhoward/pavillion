import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import CalendarService from '@/server/calendar/service/calendar';
import { CalendarEntity } from '@/server/calendar/entity/calendar';

/**
 * Creates a calendar row directly, bypassing url-name validation.
 *
 * Collisions are a property of already-stored data — a row may predate the
 * reserved list, or the current charset rules — so the fixture writes the
 * entity rather than going through CalendarService.createCalendar.
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

    expect(await service.findReservedUrlNameCollisions()).toEqual(['admin']);
  });

  it('reports a calendar whose url name is a supported locale code', async () => {
    await seedCalendar('es');
    await seedCalendar('community-events');

    expect(await service.findReservedUrlNameCollisions()).toEqual(['es']);
  });

  it('reports a reserved url name stored in mixed case', async () => {
    await seedCalendar('Admin');

    expect(await service.findReservedUrlNameCollisions()).toEqual(['Admin']);
  });

  it('reports every colliding calendar, sorted by url name', async () => {
    await seedCalendar('view');
    await seedCalendar('admin');
    await seedCalendar('community-events');
    await seedCalendar('fr');

    expect(await service.findReservedUrlNameCollisions()).toEqual(['admin', 'fr', 'view']);
  });

  it('leaves the colliding calendars in place', async () => {
    await seedCalendar('admin');

    await service.findReservedUrlNameCollisions();

    const stored = await CalendarEntity.findAll({ attributes: ['url_name'] });
    expect(stored.map(calendar => calendar.url_name)).toEqual(['admin']);
  });
});
