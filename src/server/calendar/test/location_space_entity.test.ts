import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity, LocationSpaceContentEntity } from '@/server/calendar/entity/location_space';
import { EventLocationSpace } from '@/common/model/location';

/**
 * Round-trip test for LocationSpaceEntity. Verifies the full chain
 * calendar → place → space → translatable content persists to and reads
 * back from the database, and that the @BelongsTo / @HasMany associations
 * resolve a complete EventLocationSpace domain model with multilingual
 * content via toModel().
 *
 * Also exercises the place_id foreign key at the database tier (per the
 * spec's testing-advisor note — FK rejection belongs at the entity layer,
 * not the service layer).
 */
describe('LocationSpaceEntity round-trip', () => {
  beforeAll(async () => {
    // Sync the in-memory SQLite database with all registered models so the
    // location, location_space, and location_space_content tables exist.
    // Enable SQLite foreign-key enforcement so the FK rejection test can
    // exercise the database constraint (off by default in SQLite).
    await db.sync({ force: true });
    if (db.getDialect() === 'sqlite') {
      await db.query('PRAGMA foreign_keys = ON;');
    }
  });

  it('persists a calendar + place + space + multilingual content and reads it back as a full EventLocationSpace model', async () => {
    const calendar = await CalendarEntity.create({
      id: uuidv4(),
      url_name: 'space-roundtrip-cal',
    });

    const place = await LocationEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      name: 'Convention Center',
      address: '777 NE Martin Luther King Jr Blvd',
      city: 'Portland',
      state: 'OR',
      postal_code: '97232',
      country: 'United States',
    });

    const space = await LocationSpaceEntity.create({
      id: uuidv4(),
      place_id: place.id,
    });

    await LocationSpaceContentEntity.create({
      id: uuidv4(),
      space_id: space.id,
      language: 'en',
      name: 'Pacific Room',
      accessibility_info: 'Hearing loop, 3rd floor',
    });

    await LocationSpaceContentEntity.create({
      id: uuidv4(),
      space_id: space.id,
      language: 'es',
      name: 'Sala Pacífico',
      accessibility_info: 'Bucle magnético, tercer piso',
    });

    const fetched = await LocationSpaceEntity.findByPk(space.id, {
      include: [LocationSpaceContentEntity],
    });

    expect(fetched).not.toBeNull();
    const model: EventLocationSpace = fetched!.toModel();

    expect(model).toBeInstanceOf(EventLocationSpace);
    expect(model.id).toBe(space.id);
    expect(model.placeId).toBe(place.id);

    expect(model.getLanguages().sort()).toEqual(['en', 'es']);
    expect(model.content('en').name).toBe('Pacific Room');
    expect(model.content('en').accessibilityInfo).toBe('Hearing loop, 3rd floor');
    expect(model.content('es').name).toBe('Sala Pacífico');
    expect(model.content('es').accessibilityInfo).toBe('Bucle magnético, tercer piso');
  });

  it('exposes the spaces relationship from LocationEntity (@HasMany)', async () => {
    const calendar = await CalendarEntity.create({
      id: uuidv4(),
      url_name: 'space-hasmany-cal',
    });

    const place = await LocationEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      name: 'Community Center',
    });

    await LocationSpaceEntity.create({ id: uuidv4(), place_id: place.id });
    await LocationSpaceEntity.create({ id: uuidv4(), place_id: place.id });

    const placeWithSpaces = await LocationEntity.findByPk(place.id, {
      include: [LocationSpaceEntity],
    });

    expect(placeWithSpaces).not.toBeNull();
    expect(placeWithSpaces!.spaces).toBeDefined();
    expect(placeWithSpaces!.spaces).toHaveLength(2);
  });

  it('rejects a space whose place_id references a non-existent location row', async () => {
    await expect(
      LocationSpaceEntity.create({
        id: uuidv4(),
        place_id: uuidv4(), // Random UUID, no matching LocationEntity row
      }),
    ).rejects.toThrow();
  });

  it('persists origin_uri and round-trips it through entity↔model', async () => {
    const calendar = await CalendarEntity.create({
      id: uuidv4(),
      url_name: 'space-origin-uri-cal',
    });

    const place = await LocationEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      name: 'Federated Venue',
    });

    const sourceUri = 'https://remote.example/spaces/sala-1';
    const space = await LocationSpaceEntity.create({
      id: uuidv4(),
      place_id: place.id,
      origin_uri: sourceUri,
    });

    const fetched = await LocationSpaceEntity.findByPk(space.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.origin_uri).toBe(sourceUri);

    const model = fetched!.toModel();
    expect(model.originUri).toBe(sourceUri);

    // Model -> Entity preserves originUri as origin_uri
    const rebuilt = LocationSpaceEntity.fromModel(model);
    expect(rebuilt.origin_uri).toBe(sourceUri);
  });

  it('treats null origin_uri as null on the model', async () => {
    const calendar = await CalendarEntity.create({
      id: uuidv4(),
      url_name: 'space-local-cal',
    });

    const place = await LocationEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      name: 'Local Venue',
    });

    const space = await LocationSpaceEntity.create({
      id: uuidv4(),
      place_id: place.id,
      // origin_uri omitted -> defaults to null
    });

    const fetched = await LocationSpaceEntity.findByPk(space.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.origin_uri).toBeNull();

    const model = fetched!.toModel();
    expect(model.originUri).toBeNull();

    // fromModel of a null-originUri model writes null to the column
    const rebuilt = LocationSpaceEntity.fromModel(model);
    expect(rebuilt.origin_uri).toBeNull();
  });
});
