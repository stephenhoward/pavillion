import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import LocationService from '@/server/calendar/service/locations';

/**
 * DB-backed coverage for LocationService.clearOriginUrisFromSource — the
 * calendar-domain reaction to a follower calendar unfollowing a remote
 * source. Only Place/Space rows that (a) belong to the unfollowing calendar
 * and (b) carry an origin_uri on the unfollowed actor's host are cleared.
 */
describe('LocationService.clearOriginUrisFromSource', () => {
  const service = new LocationService();
  const SOURCE_ACTOR = 'https://source.example/calendars/townhall';

  let followerId: string;
  let otherCalendarId: string;
  let matchingPlaceId: string;
  let otherHostPlaceId: string;
  let localPlaceId: string;
  let otherCalendarPlaceId: string;
  let matchingSpaceId: string;
  let otherHostSpaceId: string;
  let otherCalendarSpaceId: string;

  beforeAll(async () => {
    await db.sync({ force: true });

    followerId = uuidv4();
    otherCalendarId = uuidv4();
    await CalendarEntity.create({ id: followerId, url_name: 'follower-cal' });
    await CalendarEntity.create({ id: otherCalendarId, url_name: 'other-cal' });

    const place = (calendarId: string, originUri: string | null) =>
      LocationEntity.create({
        id: uuidv4(),
        calendar_id: calendarId,
        name: 'Place',
        address: '1 Main St',
        city: 'Town',
        state: '',
        postal_code: '',
        country: '',
        origin_uri: originUri,
      });

    matchingPlaceId = (await place(followerId, 'https://source.example/places/hall')).id;
    otherHostPlaceId = (await place(followerId, 'https://elsewhere.example/places/hall')).id;
    localPlaceId = (await place(followerId, null)).id;
    otherCalendarPlaceId = (await place(otherCalendarId, 'https://source.example/places/hall')).id;

    const space = (placeId: string, originUri: string | null) =>
      LocationSpaceEntity.create({ id: uuidv4(), place_id: placeId, origin_uri: originUri });

    matchingSpaceId = (await space(matchingPlaceId, 'https://source.example/places/hall/spaces/room-a')).id;
    otherHostSpaceId = (await space(localPlaceId, 'https://elsewhere.example/spaces/room-b')).id;
    otherCalendarSpaceId = (await space(otherCalendarPlaceId, 'https://source.example/places/hall/spaces/room-a')).id;

    await service.clearOriginUrisFromSource(followerId, SOURCE_ACTOR);
  });

  const originUriOf = async (model: typeof LocationEntity | typeof LocationSpaceEntity, id: string) =>
    (await model.findByPk(id))!.origin_uri;

  it('clears origin_uri on the follower Place stamped from the unfollowed host', async () => {
    expect(await originUriOf(LocationEntity, matchingPlaceId)).toBeNull();
  });

  it('clears origin_uri on the follower Space stamped from the unfollowed host', async () => {
    expect(await originUriOf(LocationSpaceEntity, matchingSpaceId)).toBeNull();
  });

  it('leaves follower rows stamped from a different host untouched', async () => {
    expect(await originUriOf(LocationEntity, otherHostPlaceId)).toBe('https://elsewhere.example/places/hall');
    expect(await originUriOf(LocationSpaceEntity, otherHostSpaceId)).toBe('https://elsewhere.example/spaces/room-b');
  });

  it('leaves locally-created (unstamped) rows untouched', async () => {
    expect(await originUriOf(LocationEntity, localPlaceId)).toBeNull();
  });

  it('leaves rows belonging to a calendar that did not unfollow untouched', async () => {
    expect(await originUriOf(LocationEntity, otherCalendarPlaceId)).toBe('https://source.example/places/hall');
    expect(await originUriOf(LocationSpaceEntity, otherCalendarSpaceId)).toBe('https://source.example/places/hall/spaces/room-a');
  });

  it('is a no-op for an unparseable actor URI', async () => {
    await expect(service.clearOriginUrisFromSource(otherCalendarId, 'not a url')).resolves.toBeUndefined();
    expect(await originUriOf(LocationEntity, otherCalendarPlaceId)).toBe('https://source.example/places/hall');
  });
});
