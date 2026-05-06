# Place Spaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `EventLocationSpace` (user-facing label "Space") as a translatable child entity of `EventLocation` (Place), with admin CRUD, picker integration, layered accessibility display, and full ActivityPub federation via the existing `pavillion:*` extension surface.

**Architecture:** Two-phase. Phase 1 ships the local feature (entity, model, service, REST API, edit-place Spaces section, picker flatten, public detail rendering). Phase 2 layers ActivityPub federation on top — new `pavillion:place` and `pavillion:space` extension keys, active inbound consumption with priority over the flat-Place path, and `origin_uri` columns for receiver-side dedup. Phase 1 is shippable on its own; Phase 2 has no schema changes that affect user flows.

**Tech Stack:** Sequelize-typescript entities, TranslatedModel base class, Vue 3 + Pinia frontend, Vitest unit/integration, Playwright E2E. ActivityPub federation via the existing `EventObject` model (`src/server/activitypub/model/object/event.ts`).

**Design reference:** `docs/superpowers/specs/2026-05-05-place-spaces-design.md`

---

## File Structure

### Phase 1: Domain + Admin

**Created:**
- `migrations/0032_create_location_space.ts` — adds `location_space`, `location_space_content` tables and `event.space_id` column
- `src/common/model/location.ts` — extended (not new file) with `EventLocationSpace`, `EventLocationSpaceContent`
- `src/server/calendar/entity/location_space.ts`
- `src/server/calendar/entity/location_space_content.ts`
- `src/common/test/event_location_space.test.ts`
- `src/server/calendar/test/location_space_entity.test.ts`
- `src/server/calendar/test/location_space_service.test.ts`
- `src/server/calendar/api/v1/space.ts` — Space CRUD route handlers
- `src/server/calendar/test/api/space_api.test.ts`
- `src/client/components/logged_in/calendar/edit-space.vue`
- `src/client/test/components/calendar/edit-space.test.ts`
- `tests/e2e/place-spaces.spec.ts`

**Modified:**
- `src/common/exceptions/calendar.ts` — add `SpaceLocationMismatchError`
- `src/server/calendar/entity/location.ts` — add `@HasMany(() => LocationSpaceEntity)`
- `src/server/calendar/entity/event.ts` — add `space_id` FK column + association
- `src/server/calendar/service/locations.ts` — add Space CRUD methods, extend `deleteLocation` cascade
- `src/server/calendar/service/events.ts` — invariant `Space.placeId === locationId` on create/update
- `src/server/calendar/api/v1/location.ts` — install Space routes
- `src/server/calendar/interface.ts` — expose Space methods on the calendar interface
- `src/server/public/api/v1/events.ts` (or equivalent public events API file) — return `space` field
- `src/client/service/location.ts` — Space CRUD client methods
- `src/client/stores/locationStore.ts` — Space state management
- `src/client/components/logged_in/calendar/edit-place.vue` — add Spaces section
- `src/client/components/common/location-picker-modal.vue` — flatten with Spaces and "(whole venue)" entries
- `src/client/components/common/location-display-card.vue` — render Space name + layered accessibility
- `src/site/components/event/<event-detail>.vue` (verify exact path during execution) — render layered accessibility
- Locale files (`src/client/locale/en.json` and equivalents) — new keys for picker and format strings

### Phase 2: AP Federation

**Created:**
- `migrations/0033_add_origin_uri_to_locations.ts` — adds `origin_uri` columns to `location` and `location_space`

**Modified:**
- `src/server/calendar/entity/location.ts` — add `origin_uri` column
- `src/server/calendar/entity/location_space.ts` — add `origin_uri` column
- `src/common/model/location.ts` — add `originUri` field to both classes
- `src/server/calendar/service/locations.ts` — `findOrCreateByOriginUri()` helpers
- `src/server/activitypub/model/object/event.ts` — emit `pavillion:place`/`pavillion:space` in `toActivityPubObject`; consume them with priority in `fromActivityPubObject`
- `src/server/activitypub/test/events.test.ts` — round-trip tests for the new extension keys

---

# Phase 1: Domain Model + Admin Surface

## Task 1.1: Database migration for location_space tables and event.space_id

**Files:**
- Create: `migrations/0032_create_location_space.ts`

- [ ] **Step 1: Read the create-table convention**

Read `migrations/0026_create_import_source.ts` to understand the `createTableIfNotExists` pattern, foreign key syntax, and helper imports.

- [ ] **Step 2: Write the migration**

```typescript
import { Sequelize, DataTypes } from 'sequelize';
import {
  createTableIfNotExists,
  addColumnIfNotExists,
  removeColumnIfExists,
} from '../src/server/common/migrations/helpers.js';

/**
 * Create location_space and location_space_content tables, and add
 * event.space_id column.
 *
 * Spaces represent named sub-areas within a Place (e.g., a meeting
 * room within a community center, the gazebo in a park). They have
 * translatable name and accessibilityInfo content. An event can be
 * scoped to a (Place, Space) pair, or to just a Place (whole-venue
 * event).
 *
 * Reference: docs/superpowers/specs/2026-05-05-place-spaces-design.md
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await createTableIfNotExists(queryInterface, 'location_space', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
      },
      place_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'location', key: 'id' },
      },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex('location_space', ['place_id'], {
      name: 'idx_location_space_place_id',
    });

    await createTableIfNotExists(queryInterface, 'location_space_content', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
      },
      space_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'location_space', key: 'id' },
      },
      language: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: '',
      },
      accessibility_info: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
      },
    });

    await queryInterface.addIndex('location_space_content', ['space_id'], {
      name: 'idx_location_space_content_space_id',
    });

    await addColumnIfNotExists(queryInterface, 'event', 'space_id', {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: 'location_space', key: 'id' },
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await removeColumnIfExists(queryInterface, 'event', 'space_id');
    await queryInterface.dropTable('location_space_content');
    await queryInterface.dropTable('location_space');
  },
};
```

- [ ] **Step 3: Run the migration locally**

Run: `npm run dev:backend` (the dev backend resets and re-seeds on restart, applying new migrations). Watch logs for errors.
Expected: migration applies cleanly; backend starts.

- [ ] **Step 4: Verify schema in dev DB**

Run: `psql $DATABASE_URL -c "\d location_space"` (or equivalent for SQLite).
Expected: table exists with `id`, `place_id`, timestamp columns.

- [ ] **Step 5: Commit**

```bash
git add migrations/0032_create_location_space.ts
git commit -m "feat(calendar): add location_space schema for Place sub-areas"
```

## Task 1.2: Common model — `EventLocationSpaceContent`

**Files:**
- Modify: `src/common/model/location.ts`
- Test: `src/common/test/event_location_space.test.ts`

- [ ] **Step 1: Write failing tests for `EventLocationSpaceContent`**

Create `src/common/test/event_location_space.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { EventLocationSpaceContent } from '@/common/model/location';

describe('EventLocationSpaceContent', () => {
  it('initializes with language and empty defaults', () => {
    const c = new EventLocationSpaceContent('en');
    expect(c.language).toBe('en');
    expect(c.name).toBe('');
    expect(c.accessibilityInfo).toBe('');
  });

  it('isValid requires a non-empty language', () => {
    expect(new EventLocationSpaceContent('').isValid()).toBe(false);
    expect(new EventLocationSpaceContent('en', 'Pacific Room').isValid()).toBe(true);
  });

  it('isEmpty when both name and accessibilityInfo are blank', () => {
    expect(new EventLocationSpaceContent('en').isEmpty()).toBe(true);
    expect(new EventLocationSpaceContent('en', 'Pacific Room').isEmpty()).toBe(false);
    expect(new EventLocationSpaceContent('en', '', 'has elevator').isEmpty()).toBe(false);
  });

  it('round-trips via toObject/fromObject', () => {
    const c = new EventLocationSpaceContent('fr', 'Salle Pacifique', 'Boucle auditive');
    const obj = c.toObject();
    expect(obj).toEqual({ language: 'fr', name: 'Salle Pacifique', accessibilityInfo: 'Boucle auditive' });
    const restored = EventLocationSpaceContent.fromObject(obj);
    expect(restored.language).toBe('fr');
    expect(restored.name).toBe('Salle Pacifique');
    expect(restored.accessibilityInfo).toBe('Boucle auditive');
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

Run: `npx vitest run src/common/test/event_location_space.test.ts`
Expected: FAIL — `EventLocationSpaceContent is not exported` or similar.

- [ ] **Step 3: Implement `EventLocationSpaceContent` in `src/common/model/location.ts`**

Add to `src/common/model/location.ts` after `EventLocationContent`:

```typescript
class EventLocationSpaceContent extends Model implements TranslatedContentModel {
  constructor(
    public language: string,
    public name: string = '',
    public accessibilityInfo: string = '',
  ) {
    super();
  }

  isValid(): boolean {
    return this.language.length > 0;
  }

  isEmpty(): boolean {
    return this.name.trim().length === 0 && this.accessibilityInfo.trim().length === 0;
  }

  toObject(): Record<string, any> {
    return {
      language: this.language,
      name: this.name,
      accessibilityInfo: this.accessibilityInfo,
    };
  }

  static fromObject(obj: Record<string, any>): EventLocationSpaceContent {
    return new EventLocationSpaceContent(
      obj.language,
      obj.name ?? '',
      obj.accessibilityInfo ?? '',
    );
  }
}

export { EventLocationSpaceContent };
```

Update the existing `export { ... }` line at the bottom to include `EventLocationSpaceContent`.

- [ ] **Step 4: Run the test, see it pass**

Run: `npx vitest run src/common/test/event_location_space.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/common/model/location.ts src/common/test/event_location_space.test.ts
git commit -m "feat(calendar): add EventLocationSpaceContent translated model"
```

## Task 1.3: Common model — `EventLocationSpace`

**Files:**
- Modify: `src/common/model/location.ts`
- Test: `src/common/test/event_location_space.test.ts`

- [ ] **Step 1: Add failing tests for `EventLocationSpace`**

Append to `src/common/test/event_location_space.test.ts`:

```typescript
import { EventLocationSpace } from '@/common/model/location';

describe('EventLocationSpace', () => {
  it('initializes with empty content map', () => {
    const s = new EventLocationSpace('space-uuid', 'place-uuid');
    expect(s.id).toBe('space-uuid');
    expect(s.placeId).toBe('place-uuid');
    expect(Object.keys(s._content)).toHaveLength(0);
  });

  it('createContent produces an EventLocationSpaceContent for the language', () => {
    const s = new EventLocationSpace();
    const c = s.content('en');
    expect(c).toBeInstanceOf(EventLocationSpaceContent);
    expect(c.language).toBe('en');
  });

  it('round-trips multiple languages via toObject/fromObject', () => {
    const s = new EventLocationSpace('s1', 'p1');
    s.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));
    s.addContent(new EventLocationSpaceContent('fr', 'Salle Pacifique', 'Boucle auditive'));

    const obj = s.toObject();
    expect(obj.id).toBe('s1');
    expect(obj.placeId).toBe('p1');
    expect(obj.content.en.name).toBe('Pacific Room');
    expect(obj.content.fr.name).toBe('Salle Pacifique');

    const restored = EventLocationSpace.fromObject(obj);
    expect(restored.id).toBe('s1');
    expect(restored.placeId).toBe('p1');
    expect(restored.content('en').name).toBe('Pacific Room');
    expect(restored.content('fr').accessibilityInfo).toBe('Boucle auditive');
  });
});
```

- [ ] **Step 2: Run, see it fail**

Run: `npx vitest run src/common/test/event_location_space.test.ts`
Expected: FAIL — class not exported.

- [ ] **Step 3: Implement `EventLocationSpace`**

Add to `src/common/model/location.ts` after `EventLocation`:

```typescript
class EventLocationSpace extends TranslatedModel<EventLocationSpaceContent> {
  _content: Record<string, EventLocationSpaceContent> = {};
  placeId: string = '';

  constructor(id?: string, placeId?: string) {
    super(id ?? '');
    this.placeId = placeId ?? '';
  }

  protected createContent(language: string): EventLocationSpaceContent {
    return new EventLocationSpaceContent(language);
  }

  static fromObject(obj: Record<string, any>): EventLocationSpace {
    const space = new EventLocationSpace(obj.id, obj.placeId);
    if (obj.content) {
      for (const [language, contentObj] of Object.entries(obj.content)) {
        if (typeof contentObj === 'object' && contentObj !== null) {
          const contentData = contentObj as Record<string, any>;
          contentData.language = language;
          space.addContent(EventLocationSpaceContent.fromObject(contentData));
        }
      }
    }
    return space;
  }

  toObject(): Record<string, any> {
    return {
      id: this.id,
      placeId: this.placeId,
      content: Object.fromEntries(
        Object.entries(this._content)
          .map(([language, content]) => [language, content.toObject()]),
      ),
    };
  }
}
```

Update the bottom `export` to include `EventLocationSpace`.

- [ ] **Step 4: Run, see it pass**

Run: `npx vitest run src/common/test/event_location_space.test.ts`
Expected: PASS for all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/common/model/location.ts src/common/test/event_location_space.test.ts
git commit -m "feat(calendar): add EventLocationSpace translated model"
```

## Task 1.4: `LocationSpaceContentEntity` (Sequelize entity)

**Files:**
- Create: `src/server/calendar/entity/location_space_content.ts`

- [ ] **Step 1: Implement the entity**

Mirror `src/server/calendar/entity/location_content.ts`:

```typescript
import { Model, Table, Column, PrimaryKey, BelongsTo, DataType, ForeignKey } from 'sequelize-typescript';

import { EventLocationSpaceContent } from '@/common/model/location';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';

@Table({ tableName: 'location_space_content', timestamps: false })
export class LocationSpaceContentEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID, defaultValue: DataType.UUIDV4 })
  declare id: string;

  @ForeignKey(() => LocationSpaceEntity)
  @Column({ type: DataType.UUID })
  declare space_id: string;

  @Column({ type: DataType.STRING })
  declare language: string;

  @Column({ type: DataType.STRING })
  declare name: string;

  @Column({ type: DataType.TEXT })
  declare accessibility_info: string;

  @BelongsTo(() => LocationSpaceEntity)
  declare space: LocationSpaceEntity;

  toModel(): EventLocationSpaceContent {
    return new EventLocationSpaceContent(
      this.language,
      this.name ?? '',
      this.accessibility_info ?? '',
    );
  }

  static fromModel(spaceId: string, content: EventLocationSpaceContent): LocationSpaceContentEntity {
    return LocationSpaceContentEntity.build({
      space_id: spaceId,
      language: content.language,
      name: content.name,
      accessibility_info: content.accessibilityInfo,
    });
  }
}
```

- [ ] **Step 2: Verify with TypeScript compile**

Run: `npx tsc --noEmit`
Expected: any unresolved imports about `LocationSpaceEntity` are expected (next task) — confirm no other errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/calendar/entity/location_space_content.ts
git commit -m "feat(calendar): add LocationSpaceContentEntity"
```

## Task 1.5: `LocationSpaceEntity` (Sequelize entity)

**Files:**
- Create: `src/server/calendar/entity/location_space.ts`
- Test: `src/server/calendar/test/location_space_entity.test.ts`

- [ ] **Step 1: Implement the entity**

Mirror `src/server/calendar/entity/location.ts`:

```typescript
import { Model, Table, Column, PrimaryKey, BelongsTo, HasMany, DataType, ForeignKey, CreatedAt, UpdatedAt } from 'sequelize-typescript';

import { EventLocationSpace } from '@/common/model/location';
import db from '@/server/common/entity/db';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceContentEntity } from '@/server/calendar/entity/location_space_content';

@Table({ tableName: 'location_space', timestamps: true })
class LocationSpaceEntity extends Model {
  @PrimaryKey
  @Column({ type: DataType.UUID })
  declare id: string;

  @ForeignKey(() => LocationEntity)
  @Column({ type: DataType.UUID })
  declare place_id: string;

  @CreatedAt
  declare createdAt: Date;

  @UpdatedAt
  declare updatedAt: Date;

  @HasMany(() => LocationSpaceContentEntity)
  declare content: LocationSpaceContentEntity[];

  @BelongsTo(() => LocationEntity)
  declare place: LocationEntity;

  toModel(): EventLocationSpace {
    const space = new EventLocationSpace(this.id, this.place_id);
    if (this.content) {
      for (const c of this.content) {
        space.addContent(c.toModel());
      }
    }
    return space;
  }

  static fromModel(space: EventLocationSpace): LocationSpaceEntity {
    return LocationSpaceEntity.build({
      id: space.id,
      place_id: space.placeId,
    });
  }
}

db.addModels([LocationSpaceEntity, LocationSpaceContentEntity]);

export { LocationSpaceEntity };
```

- [ ] **Step 2: Add `@HasMany(() => LocationSpaceEntity)` to `LocationEntity`**

Modify `src/server/calendar/entity/location.ts` — add import and association:

```typescript
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
// ... inside the class:
  @HasMany(() => LocationSpaceEntity)
  declare spaces: LocationSpaceEntity[];
```

- [ ] **Step 3: Write failing entity round-trip test**

Create `src/server/calendar/test/location_space_entity.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { initializeDatabase } from '@/server/common/test/helpers';
import { LocationEntity } from '@/server/calendar/entity/location';
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';
import { LocationSpaceContentEntity } from '@/server/calendar/entity/location_space_content';
import { CalendarEntity } from '@/server/calendar/entity/calendar';
import { EventLocationSpace } from '@/common/model/location';

describe('LocationSpaceEntity round-trip', () => {
  beforeEach(async () => {
    await initializeDatabase();
  });

  it('persists and reads back a Space with content', async () => {
    const calendar = await CalendarEntity.create({ id: uuidv4(), url_name: 'testcal' });
    const place = await LocationEntity.create({
      id: uuidv4(),
      calendar_id: calendar.id,
      name: 'Convention Center',
    });

    const space = await LocationSpaceEntity.create({
      id: uuidv4(),
      place_id: place.id,
    });
    await LocationSpaceContentEntity.create({
      space_id: space.id,
      language: 'en',
      name: 'Pacific Room',
      accessibility_info: 'Hearing loop, 3rd floor',
    });

    const fetched = await LocationSpaceEntity.findByPk(space.id, {
      include: [LocationSpaceContentEntity],
    });
    expect(fetched).toBeTruthy();

    const model: EventLocationSpace = fetched!.toModel();
    expect(model.placeId).toBe(place.id);
    expect(model.content('en').name).toBe('Pacific Room');
    expect(model.content('en').accessibilityInfo).toBe('Hearing loop, 3rd floor');
  });
});
```

(If `initializeDatabase` is named differently in this codebase, look at any existing entity test in `src/server/calendar/test/` for the canonical setup helper.)

- [ ] **Step 4: Run the entity test**

Run: `npx vitest run src/server/calendar/test/location_space_entity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/calendar/entity/location_space.ts src/server/calendar/entity/location.ts src/server/calendar/test/location_space_entity.test.ts
git commit -m "feat(calendar): add LocationSpaceEntity with hasMany on LocationEntity"
```

## Task 1.6: Add `space_id` to `EventEntity` and `space` to `CalendarEvent` model

**Files:**
- Modify: `src/server/calendar/entity/event.ts`
- Modify: `src/common/model/events.ts`

- [ ] **Step 1: Add `space_id` FK to `EventEntity`**

In `src/server/calendar/entity/event.ts`, after the existing `location_id` block (around line 44–46), add:

```typescript
import { LocationSpaceEntity } from '@/server/calendar/entity/location_space';

// Inside the class, near location_id:
  @ForeignKey(() => LocationSpaceEntity)
  @Column({ type: DataType.UUID, allowNull: true })
  declare space_id: string | null;

  @BelongsTo(() => LocationSpaceEntity, 'space_id')
  declare space: LocationSpaceEntity;
```

Update `toModel()` and `fromModel()` to wire `space_id` ↔ `event.space`:
- In `toModel()`, set `model.space = this.space ? this.space.toModel() : null;`
- In `fromModel()`, set `space_id: event.space?.id ?? null`

- [ ] **Step 2: Add `space` field to `CalendarEvent` model**

In `src/common/model/events.ts`, add to the class:

```typescript
import { EventLocationSpace } from '@/common/model/location';

// Add field declaration:
  space: EventLocationSpace | null = null;
```

Extend `toObject()` to include `space: this.space?.toObject() ?? null`.
Extend `fromObject()` to read `space: obj.space ? EventLocationSpace.fromObject(obj.space) : null`.

- [ ] **Step 3: Write a failing test for round-trip with Space**

Add to an existing event model test (e.g., `src/common/test/calendar_event.test.ts` if it exists, otherwise next to event_location_space.test.ts):

```typescript
it('CalendarEvent round-trips with a Space reference', () => {
  const space = new EventLocationSpace('s1', 'p1');
  space.addContent(new EventLocationSpaceContent('en', 'Pacific Room'));

  const event = new CalendarEvent('e1');
  event.space = space;

  const restored = CalendarEvent.fromObject(event.toObject());
  expect(restored.space?.id).toBe('s1');
  expect(restored.space?.content('en').name).toBe('Pacific Room');
});
```

- [ ] **Step 4: Run, see it pass**

Run: `npx vitest run src/common/test/`
Expected: new test passes; existing tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/server/calendar/entity/event.ts src/common/model/events.ts src/common/test/
git commit -m "feat(calendar): add space reference to Event entity and model"
```

## Task 1.7: `SpaceLocationMismatchError` exception

**Files:**
- Modify: `src/common/exceptions/calendar.ts`

- [ ] **Step 1: Read the existing exception pattern**

Open `src/common/exceptions/calendar.ts` to understand the conventions: class signature, `errorName` field for serialization (per `backend-error-serialization` skill), constructor message format.

- [ ] **Step 2: Add the exception class**

Append to `src/common/exceptions/calendar.ts`:

```typescript
export class SpaceLocationMismatchError extends Error {
  errorName = 'SpaceLocationMismatchError';
  constructor(public spaceId: string, public expectedPlaceId: string, public actualPlaceId: string) {
    super(`Space ${spaceId} belongs to place ${actualPlaceId}, not ${expectedPlaceId}`);
  }
}
```

- [ ] **Step 3: Compile-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/common/exceptions/calendar.ts
git commit -m "feat(calendar): add SpaceLocationMismatchError exception"
```

## Task 1.8: `LocationsService` Space CRUD

**Files:**
- Modify: `src/server/calendar/service/locations.ts`
- Test: `src/server/calendar/test/location_space_service.test.ts`

- [ ] **Step 1: Read the existing `LocationsService` for pattern**

Read `src/server/calendar/service/locations.ts` end to end. Note the conventions for: calendar ownership checks, transaction handling, content entity replacement on update, return shapes.

- [ ] **Step 2: Write failing service tests**

Create `src/server/calendar/test/location_space_service.test.ts` covering:
- `createSpace(calendar, placeId, contentByLang)` returns a populated `EventLocationSpace`
- `createSpace` rejects when the Place doesn't belong to the calendar
- `updateSpace(calendar, spaceId, contentByLang)` replaces content rows
- `getSpacesForPlace(calendar, placeId)` returns the Place's Spaces
- `deleteSpace(calendar, spaceId)` removes the Space and content; nullifies `event.space_id` on affected events; leaves `event.location_id` intact

Use the same setup helpers as `src/server/calendar/test/location_service.test.ts`. Build a sandbox per test, seed a calendar + Place + Space + Event, exercise each method.

(Test code: write enough to validate each path. Length: ~150–200 lines. Mirror the existing `location_service.test.ts` style.)

- [ ] **Step 3: Run, see all fail**

Run: `npx vitest run src/server/calendar/test/location_space_service.test.ts`
Expected: each test fails with "method not defined" or similar.

- [ ] **Step 4: Implement the service methods**

Add to `LocationsService` class in `src/server/calendar/service/locations.ts`:

```typescript
async createSpace(
  calendar: Calendar,
  placeId: string,
  contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
): Promise<EventLocationSpace> {
  const place = await LocationEntity.findByPk(placeId);
  if (!place || place.calendar_id !== calendar.id) {
    throw new LocationNotFoundError(placeId); // or whichever exception fits the existing pattern
  }

  const space = await LocationSpaceEntity.create({
    id: uuidv4(),
    place_id: placeId,
  });

  for (const [lang, content] of Object.entries(contentByLang)) {
    await LocationSpaceContentEntity.create({
      space_id: space.id,
      language: lang,
      name: content.name,
      accessibility_info: content.accessibilityInfo,
    });
  }

  const fetched = await LocationSpaceEntity.findByPk(space.id, {
    include: [LocationSpaceContentEntity],
  });
  return fetched!.toModel();
}

async updateSpace(
  calendar: Calendar,
  spaceId: string,
  contentByLang: Record<string, { name: string; accessibilityInfo: string }>,
): Promise<EventLocationSpace | null> {
  const space = await LocationSpaceEntity.findByPk(spaceId, {
    include: [{ model: LocationEntity, as: 'place' }],
  });
  if (!space || space.place.calendar_id !== calendar.id) {
    return null;
  }

  await LocationSpaceContentEntity.destroy({ where: { space_id: spaceId } });
  for (const [lang, content] of Object.entries(contentByLang)) {
    await LocationSpaceContentEntity.create({
      space_id: spaceId,
      language: lang,
      name: content.name,
      accessibility_info: content.accessibilityInfo,
    });
  }

  const fetched = await LocationSpaceEntity.findByPk(spaceId, {
    include: [LocationSpaceContentEntity],
  });
  return fetched!.toModel();
}

async getSpacesForPlace(calendar: Calendar, placeId: string): Promise<EventLocationSpace[]> {
  const place = await LocationEntity.findByPk(placeId);
  if (!place || place.calendar_id !== calendar.id) {
    return [];
  }
  const entities = await LocationSpaceEntity.findAll({
    where: { place_id: placeId },
    include: [LocationSpaceContentEntity],
  });
  return entities.map(e => e.toModel());
}

async deleteSpace(calendar: Calendar, spaceId: string): Promise<boolean> {
  const space = await LocationSpaceEntity.findByPk(spaceId, {
    include: [{ model: LocationEntity, as: 'place' }],
  });
  if (!space || space.place.calendar_id !== calendar.id) {
    return false;
  }

  // Nullify space_id on referencing events
  await EventEntity.update(
    { space_id: null },
    { where: { space_id: spaceId } },
  );

  // Delete content rows then the space
  await LocationSpaceContentEntity.destroy({ where: { space_id: spaceId } });
  await space.destroy();
  return true;
}
```

(Adjust `LocationNotFoundError` import / fallback to whichever exception the existing `LocationsService` raises for missing-or-unauthorized Place.)

- [ ] **Step 5: Run, see passing**

Run: `npx vitest run src/server/calendar/test/location_space_service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/calendar/service/locations.ts src/server/calendar/test/location_space_service.test.ts
git commit -m "feat(calendar): add Space CRUD on LocationsService"
```

## Task 1.9: Extend `LocationsService.deleteLocation` to cascade Spaces

**Files:**
- Modify: `src/server/calendar/service/locations.ts`
- Modify: `src/server/calendar/test/location_service.test.ts` (or add to space service test)

- [ ] **Step 1: Add a failing test for Place-delete-cascades-Spaces**

Append to `src/server/calendar/test/location_service.test.ts` (or wherever the existing `deleteLocation` test lives):

```typescript
it('deleteLocation cascades Space + content removal and nullifies event.space_id', async () => {
  // Seed: calendar + place + 1 space + event referencing both
  // ... (mirror existing setup)

  await locationsService.deleteLocation(calendar, place.id);

  expect(await LocationSpaceEntity.findByPk(space.id)).toBeNull();
  expect(await LocationSpaceContentEntity.findAll({ where: { space_id: space.id } })).toHaveLength(0);

  const evt = await EventEntity.findByPk(event.id);
  expect(evt?.location_id).toBeNull();
  expect(evt?.space_id).toBeNull();
});
```

- [ ] **Step 2: Run, see fail**

Run: `npx vitest run src/server/calendar/test/location_service.test.ts`
Expected: FAIL — `space.id` row still exists after delete.

- [ ] **Step 3: Update `deleteLocation`**

In `src/server/calendar/service/locations.ts`, modify `deleteLocation`:

```typescript
async deleteLocation(calendar: Calendar, locationId: string): Promise<boolean> {
  const entity = await LocationEntity.findByPk(locationId);
  if (!entity || entity.calendar_id !== calendar.id) {
    return false;
  }

  // Nullify both location_id AND space_id on associated events
  await EventEntity.update(
    { location_id: null, space_id: null },
    { where: { location_id: locationId } },
  );

  // Cascade-delete Spaces and their content
  const spaces = await LocationSpaceEntity.findAll({ where: { place_id: locationId } });
  if (spaces.length > 0) {
    const spaceIds = spaces.map(s => s.id);
    await LocationSpaceContentEntity.destroy({ where: { space_id: spaceIds } });
    await LocationSpaceEntity.destroy({ where: { place_id: locationId } });
  }

  // Existing content + entity cleanup
  await LocationContentEntity.destroy({ where: { location_id: locationId } });
  await entity.destroy();

  return true;
}
```

- [ ] **Step 4: Run, see pass**

Run: `npx vitest run src/server/calendar/test/location_service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/calendar/service/locations.ts src/server/calendar/test/location_service.test.ts
git commit -m "feat(calendar): cascade Spaces on Place deletion"
```

## Task 1.10: Events service — Space/Place invariant

**Files:**
- Modify: `src/server/calendar/service/events.ts`
- Modify: existing events service test file (likely `src/server/calendar/test/events_service.test.ts` — confirm path before writing)

- [ ] **Step 1: Add failing test for invariant rejection**

Add a test that creates two Places and one Space under Place A, then calls the event create/update path with `(placeId = B, spaceId = A's space)`, expecting `SpaceLocationMismatchError`.

- [ ] **Step 2: Run, see fail**

Run: `npx vitest run src/server/calendar/test/events_service.test.ts`
Expected: FAIL — wrong Space accepted silently.

- [ ] **Step 3: Add invariant check in events service**

In `src/server/calendar/service/events.ts`, find the create and update methods that accept `locationId` / `spaceId`. Before persisting, when both are non-null:

```typescript
import { SpaceLocationMismatchError } from '@/common/exceptions/calendar';

if (eventParams.locationId && eventParams.spaceId) {
  const space = await LocationSpaceEntity.findByPk(eventParams.spaceId);
  if (!space) {
    throw new SpaceLocationMismatchError(eventParams.spaceId, eventParams.locationId, 'unknown');
  }
  if (space.place_id !== eventParams.locationId) {
    throw new SpaceLocationMismatchError(eventParams.spaceId, eventParams.locationId, space.place_id);
  }
}
```

Apply to both create and update code paths. Extract as a private helper if both touch the same logic.

- [ ] **Step 4: Run, see pass**

Run: `npx vitest run src/server/calendar/test/events_service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/calendar/service/events.ts src/server/calendar/test/events_service.test.ts
git commit -m "feat(calendar): enforce Space.placeId === locationId on event create/update"
```

## Task 1.11: REST API — Space CRUD endpoints

**Files:**
- Create: `src/server/calendar/api/v1/space.ts`
- Modify: `src/server/calendar/api/v1/location.ts` (install Space routes)
- Modify: `src/server/calendar/interface.ts` (expose Space methods)
- Test: `src/server/calendar/test/api/space_api.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `src/server/calendar/test/api/space_api.test.ts` covering:
- `POST /api/v1/calendars/:urlname/places/:placeId/spaces` — creates and returns 201 with the Space
- `POST` — 403 when caller isn't a calendar editor
- `POST` — 404 when Place doesn't exist or isn't on this calendar
- `GET /api/v1/calendars/:urlname/places/:placeId/spaces` — returns array
- `PUT /api/v1/calendars/:urlname/spaces/:spaceId` — updates content
- `DELETE /api/v1/calendars/:urlname/spaces/:spaceId` — returns 204

Mirror the existing test patterns from `src/server/calendar/test/api/location_api.test.ts` (or whichever existing place-API test file is canonical — check before writing).

- [ ] **Step 2: Run, see fail**

Run: `npx vitest run src/server/calendar/test/api/space_api.test.ts`
Expected: FAIL — routes not mounted.

- [ ] **Step 3: Implement Space route handlers**

Create `src/server/calendar/api/v1/space.ts` mirroring the structure of `location.ts`. Provide `installHandlers(app, prefix)` that mounts:
- `POST {prefix}/calendars/:urlname/places/:placeId/spaces`
- `GET {prefix}/calendars/:urlname/places/:placeId/spaces`
- `GET {prefix}/calendars/:urlname/spaces/:spaceId`
- `PUT {prefix}/calendars/:urlname/spaces/:spaceId`
- `DELETE {prefix}/calendars/:urlname/spaces/:spaceId`

Each handler:
1. Resolves the calendar from `:urlname`, returns 404 if missing.
2. Verifies the caller is an editor (use the same authorization helper as `location.ts`).
3. Calls the corresponding `LocationsService` method.
4. Returns the result as JSON or maps domain exceptions to 400/404.

- [ ] **Step 4: Wire routes in `location.ts`**

In `src/server/calendar/api/v1/location.ts`, where existing routes are installed, also instantiate and install the SpaceRoutes class.

- [ ] **Step 5: Update calendar interface**

In `src/server/calendar/interface.ts`, expose `getSpacesForPlace`, `createSpace`, `updateSpace`, `deleteSpace`. (Only add what other domains will call. If only the API uses these and they don't cross domains, this step may be skippable — confirm against existing pattern for location interface.)

- [ ] **Step 6: Run, see pass**

Run: `npx vitest run src/server/calendar/test/api/space_api.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/server/calendar/api/v1/space.ts src/server/calendar/api/v1/location.ts src/server/calendar/interface.ts src/server/calendar/test/api/space_api.test.ts
git commit -m "feat(calendar): add Space CRUD REST API"
```

## Task 1.12: Event create/update API — accept `spaceId`

**Files:**
- Modify: `src/server/calendar/api/v1/events.ts`
- Modify: existing events API test file

- [ ] **Step 1: Add failing API tests**

Test that `POST` and `PUT` for an event accept a `spaceId` field and persist it; that mismatched `(locationId, spaceId)` returns 400 with `SpaceLocationMismatchError` errorName.

- [ ] **Step 2: Run, see fail**

Run the events API test file.
Expected: FAIL — `spaceId` ignored or 200 returned for mismatch.

- [ ] **Step 3: Update the event API handler**

Add `spaceId` to the request body parsing, pass to the service method. Map `SpaceLocationMismatchError` to 400 with the existing error-serialization pattern (`errorName` field).

- [ ] **Step 4: Run, see pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/calendar/api/v1/events.ts src/server/calendar/test/
git commit -m "feat(calendar): event API accepts spaceId with mismatch validation"
```

## Task 1.13: Public REST API — return `space` field

**Files:**
- Modify: public events API handler (look in `src/server/public/` — confirm exact file)
- Modify: corresponding test file

- [ ] **Step 1: Add failing test**

For the public event endpoint, assert the returned event includes `space: {...} | null` alongside `location`. Test both with-Space and without-Space cases.

- [ ] **Step 2: Run, see fail**

Expected: `space` field missing.

- [ ] **Step 3: Update the response shape**

In the public events API serialization path, include `space: event.space?.toObject() ?? null` alongside `location`.

- [ ] **Step 4: Run, see pass**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/public/ src/server/public/test/
git commit -m "feat(public-api): expose space field on event responses"
```

## Task 1.14: Frontend — service and store updates

**Files:**
- Modify: `src/client/service/location.ts`
- Modify: `src/client/stores/locationStore.ts`
- Modify: `src/client/test/location_service.test.ts`
- Modify: `src/client/test/locationStore.test.ts`

- [ ] **Step 1: Write failing tests for new client methods**

Tests should cover:
- `locationService.getSpaces(calendarUrlName, placeId)` returns a list
- `locationService.createSpace(calendarUrlName, placeId, contentByLang)` posts and returns the new Space
- `locationService.updateSpace(calendarUrlName, spaceId, contentByLang)`
- `locationService.deleteSpace(calendarUrlName, spaceId)`
- `locationStore` exposes `spacesForPlace(placeId)` and refetches after CRUD operations

Mirror the existing place methods' test patterns.

- [ ] **Step 2: Run, see fail**

Expected: methods undefined.

- [ ] **Step 3: Implement client methods**

Add the four CRUD methods to `LocationService` and the matching reactive accessors to `locationStore`.

- [ ] **Step 4: Run, see pass**

- [ ] **Step 5: Commit**

```bash
git add src/client/service/location.ts src/client/stores/locationStore.ts src/client/test/
git commit -m "feat(client): add Space CRUD to location service and store"
```

## Task 1.15: i18n — picker and format keys

**Files:**
- Modify: locale JSON files (find with `find src/client/locales src/client/locale src/site/locales src/site/locale -name "*.json" 2>/dev/null` — exact path varies by project)

- [ ] **Step 1: Add new translation keys**

In each locale file (start with `en`), add to the `place` namespace (or wherever `place.title`, `place.unnamed_place`, etc. live):

```json
{
  "place": {
    "format": {
      "with_space": "{{place}} — {{space}}"
    },
    "picker": {
      "whole_venue_suffix": "(whole venue)"
    },
    "space": {
      "section_title": "Spaces",
      "add_button": "Add space",
      "delete_confirm_message": "Delete space \"{{name}}\"?",
      "delete_confirm_event_count": "{{count}} events will become whole-venue events.",
      "venue_accessibility_label": "Venue accessibility",
      "space_accessibility_label": "Space accessibility"
    }
  }
}
```

- [ ] **Step 2: Add equivalents in other locales** (or English-only as placeholder, depending on project's i18n bootstrap policy — check the i18n skill / existing patterns)

- [ ] **Step 3: Commit**

```bash
git add src/client/locale/ src/site/locale/  # or correct paths
git commit -m "feat(i18n): add Space picker, format, and editor strings"
```

## Task 1.16: `edit-place.vue` — Spaces section

**Files:**
- Modify: `src/client/components/logged_in/calendar/edit-place.vue`
- Create: `src/client/components/logged_in/calendar/edit-space.vue`
- Test: `src/client/test/components/calendar/edit-space.test.ts`

- [ ] **Step 1: Read existing `edit-place.vue` to understand the editor pattern**

Read the file end-to-end. Note: form data shape, language tab handling, save/cancel flow, accessibility-info translation handling.

- [ ] **Step 2: Build `edit-space.vue` (inline Space editor)**

Mirrors the relevant subset of `edit-place.vue`:
- Form fields: per-language `name` and `accessibilityInfo` (with the language tab pattern reused from `edit-place.vue`)
- Validation: at least one language has a non-empty name
- Save: calls `locationStore.createSpace` or `locationStore.updateSpace`
- Cancel: closes without persisting

This is a child editor surfaced as either a modal or an inline expandable card within the Places editor.

- [ ] **Step 3: Add Spaces section to `edit-place.vue`**

Below the existing Place fields, add a `<section class="spaces">` containing:
- Section title from `t('place.space.section_title')`
- List of existing Spaces (display name in current language, accessibility-info preview, edit/delete buttons)
- "Add space" button that mounts `<edit-space>`

The list uses `locationStore.spacesForPlace(props.placeId)`.

- [ ] **Step 4: Write component tests**

Create `src/client/test/components/calendar/edit-space.test.ts` covering:
- Rendering with existing data
- Validation failure (no name)
- Save calls `locationStore.createSpace` / `updateSpace` correctly
- Cancel closes without persisting

- [ ] **Step 5: Run, see all pass**

Run: `npx vitest run src/client/test/components/calendar/edit-space.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/logged_in/calendar/ src/client/test/components/calendar/edit-space.test.ts
git commit -m "feat(client): add Spaces section to Place editor"
```

## Task 1.17: `location-picker-modal.vue` — flatten with Spaces

**Files:**
- Modify: `src/client/components/common/location-picker-modal.vue`
- Modify: `src/client/test/components/location-picker-modal.test.ts`

- [ ] **Step 1: Read the existing picker**

Note its current data shape, search/filter logic, selection event payload.

- [ ] **Step 2: Add failing tests**

Tests should cover:
- A Place with 0 Spaces renders one entry with the Place name; selection emits `{ placeId, spaceId: null }`
- A Place with 2 Spaces renders 3 entries: `(whole venue)` + 2 Space entries; each selects the right combination
- Search "pacific" matches "Convention Center — Pacific Room"
- aria-labels disambiguate whole-venue vs. specific Spaces

- [ ] **Step 3: Run, see fail**

- [ ] **Step 4: Implement the flatten logic**

Build a derived `pickerEntries` computed that maps `places` (each with inlined `spaces`) to the flat entry list per the spec. Selection emits `{ placeId, spaceId: spaceId | null }`. Update the parent (event editor) to read both fields.

- [ ] **Step 5: Run, see pass**

- [ ] **Step 6: Commit**

```bash
git add src/client/components/common/location-picker-modal.vue src/client/test/components/location-picker-modal.test.ts
git commit -m "feat(client): flatten location picker with Spaces and whole-venue entries"
```

## Task 1.18: Display — site SPA event detail accessibility blocks

**Files:**
- Modify: site SPA event detail component (find by searching for the file that renders `event.location.accessibilityInfo` today)
- Modify: matching test file

- [ ] **Step 1: Find the existing accessibility render**

Run: `grep -rn "accessibilityInfo" src/site/components src/client/components/common`
Identify the component(s) that render the existing single accessibility block.

- [ ] **Step 2: Write failing test**

For the component, assert:
- When event has both Place and Space accessibility, two labeled subsections render (`venue_accessibility_label`, `space_accessibility_label`)
- When only Place has content, only the venue subsection renders
- When only Space has content, only the space subsection renders
- When both are empty, the accessibility container is hidden
- Header line uses `t('place.format.with_space', { place, space })` when Space present; `Place.name` alone otherwise

- [ ] **Step 3: Run, see fail**

- [ ] **Step 4: Update the component**

Replace the single accessibility render with the two-section layered version. Header line uses the new format key.

- [ ] **Step 5: Run, see pass**

- [ ] **Step 6: Commit**

```bash
git add src/site/components/ src/client/components/common/location-display-card.vue src/site/test/ src/client/test/components/location-display-card.test.ts
git commit -m "feat(site): render layered Place+Space accessibility on event detail"
```

## Task 1.19: E2E — full Phase 1 scenario

**Files:**
- Create: `tests/e2e/place-spaces.spec.ts`

- [ ] **Step 1: Identify the e2e harness**

Look at any existing `tests/e2e/*.spec.ts` to confirm the Playwright setup, login helpers, and seed data conventions.

- [ ] **Step 2: Write the scenario**

```typescript
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test('Place with Spaces — full flow', async ({ page }) => {
  await loginAsAdmin(page);

  // Create a Place
  await page.goto('/calendars/test-cal/places');
  await page.click('[data-testid="add-place"]');
  await page.fill('[name="place-name"]', 'Convention Center');
  await page.fill('[name="place-address"]', '100 Main St');
  await page.click('[data-testid="save-place"]');

  // Add two Spaces
  await page.click('[data-testid="place-edit:Convention Center"]');
  await page.click('[data-testid="add-space"]');
  await page.fill('[name="space-name"]', 'Pacific Room');
  await page.fill('[name="space-accessibility"]', 'Hearing loop, 3rd floor');
  await page.click('[data-testid="save-space"]');

  await page.click('[data-testid="add-space"]');
  await page.fill('[name="space-name"]', 'Council Chambers');
  await page.click('[data-testid="save-space"]');

  // Create an event in the Pacific Room
  await page.goto('/calendars/test-cal/events/new');
  await page.click('[data-testid="pick-location"]');
  await page.click('[data-testid="picker-entry:Convention Center — Pacific Room"]');
  await page.fill('[name="event-name"]', 'Recurring Meeting');
  await page.click('[data-testid="save-event"]');

  // View public detail
  await page.goto('/view/test-cal/events/recurring-meeting');
  await expect(page.locator('h1')).toContainText('Recurring Meeting');
  await expect(page.locator('[data-testid="event-location"]')).toContainText('Convention Center — Pacific Room');
  await expect(page.locator('[data-testid="space-accessibility"]')).toContainText('Hearing loop, 3rd floor');

  // Switch to whole-venue
  await page.goto('/calendars/test-cal/events');
  await page.click('[data-testid="event-edit:Recurring Meeting"]');
  await page.click('[data-testid="pick-location"]');
  await page.click('[data-testid="picker-entry:Convention Center (whole venue)"]');
  await page.click('[data-testid="save-event"]');

  await page.goto('/view/test-cal/events/recurring-meeting');
  await expect(page.locator('[data-testid="event-location"]')).toContainText('Convention Center');
  await expect(page.locator('[data-testid="event-location"]')).not.toContainText('Pacific Room');
  await expect(page.locator('[data-testid="space-accessibility"]')).not.toBeVisible();
});
```

(Adjust selectors to match actual `data-testid` conventions in this codebase.)

- [ ] **Step 3: Run the e2e test**

Run: `npm run test:e2e -- place-spaces`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/place-spaces.spec.ts
git commit -m "test(e2e): cover Place + Space create, pick, and display"
```

---

# Phase 2: ActivityPub Federation

## Task 2.1: Migration — `origin_uri` columns on `location` and `location_space`

**Files:**
- Create: `migrations/0033_add_origin_uri_to_locations.ts`

- [ ] **Step 1: Write the migration**

```typescript
import { Sequelize, DataTypes } from 'sequelize';
import { addColumnIfNotExists, removeColumnIfExists } from '../src/server/common/migrations/helpers.js';

/**
 * Add origin_uri to location and location_space.
 *
 * Used as an identity hint for AP-originated records so the inbox can
 * dedup the same source Place/Space across many incoming events.
 * Null for locally-created records.
 */
export default {
  async up({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();

    await addColumnIfNotExists(queryInterface, 'location', 'origin_uri', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
    await queryInterface.addIndex('location', ['origin_uri'], {
      name: 'idx_location_origin_uri',
    });

    await addColumnIfNotExists(queryInterface, 'location_space', 'origin_uri', {
      type: DataTypes.STRING(2048),
      allowNull: true,
    });
    await queryInterface.addIndex('location_space', ['origin_uri'], {
      name: 'idx_location_space_origin_uri',
    });
  },

  async down({ context: sequelize }: { context: Sequelize }) {
    const queryInterface = sequelize.getQueryInterface();
    await queryInterface.removeIndex('location_space', 'idx_location_space_origin_uri');
    await removeColumnIfExists(queryInterface, 'location_space', 'origin_uri');
    await queryInterface.removeIndex('location', 'idx_location_origin_uri');
    await removeColumnIfExists(queryInterface, 'location', 'origin_uri');
  },
};
```

- [ ] **Step 2: Apply locally and verify**

Restart `npm run dev:backend`. Verify migrations applied.

- [ ] **Step 3: Commit**

```bash
git add migrations/0033_add_origin_uri_to_locations.ts
git commit -m "feat(activitypub): add origin_uri columns for AP dedup"
```

## Task 2.2: Entities and models — `originUri` field

**Files:**
- Modify: `src/server/calendar/entity/location.ts`
- Modify: `src/server/calendar/entity/location_space.ts`
- Modify: `src/common/model/location.ts`

- [ ] **Step 1: Add the column to both entities**

Add to each entity:

```typescript
@Column({ type: DataType.STRING(2048), allowNull: true })
declare origin_uri: string | null;
```

Update `toModel()` and `fromModel()` to wire `origin_uri ↔ originUri`.

- [ ] **Step 2: Add `originUri` to both models**

In `src/common/model/location.ts`, add `originUri: string | null = null` to both `EventLocation` and `EventLocationSpace`. Extend `toObject()` and `fromObject()` accordingly.

- [ ] **Step 3: Add round-trip tests for the new field**

Add a test for each model and entity confirming `originUri` survives round-trips.

- [ ] **Step 4: Run, see pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/calendar/entity/location.ts src/server/calendar/entity/location_space.ts src/common/model/location.ts src/common/test/ src/server/calendar/test/
git commit -m "feat(activitypub): add originUri field to Place/Space models"
```

## Task 2.3: AP outbound — emit `pavillion:place`

**Files:**
- Modify: `src/server/activitypub/model/object/event.ts`
- Modify: `src/server/activitypub/test/events.test.ts`

**WIRE SHAPE NOTE (2026-05-05 update):** Per Option B decision (see spec, Outbound serialization), `name` lives in `content[lang].name`, NOT as a top-level key. Today every entry's `name` carries the same `EventLocation.name` string, since Place names are not yet translatable. This shape is forward-compatible — when Place names later become translatable, the wire format does not change.

- [ ] **Step 1: Add failing serialization test**

In `src/server/activitypub/test/events.test.ts`, add:

```typescript
it('toActivityPubObject emits pavillion:place with per-language content for any event with a location', () => {
  const event = buildEventWithPlace({
    placeName: 'Convention Center',
    address: '100 Main St',
    city: 'Springfield',
    accessibility: { en: 'Accessible parking', fr: 'Stationnement accessible' },
  });
  const ap = new EventObject(calendar, event).toActivityPubObject();

  expect(ap['pavillion:place']).toBeDefined();
  expect(ap['pavillion:place'].id).toMatch(/^https:\/\/[^/]+\/calendars\/[^/]+\/places\/[a-f0-9-]+$/);
  // No top-level 'name' field — name lives in content per language
  expect(ap['pavillion:place'].name).toBeUndefined();
  expect(ap['pavillion:place'].address).toBe('100 Main St');
  expect(ap['pavillion:place'].content.en.name).toBe('Convention Center');
  expect(ap['pavillion:place'].content.fr.name).toBe('Convention Center');
  expect(ap['pavillion:place'].content.en.accessibilityInfo).toBe('Accessible parking');
  expect(ap['pavillion:place'].content.fr.accessibilityInfo).toBe('Stationnement accessible');
});

it('toActivityPubObject omits pavillion:place when event has no location', () => {
  const event = buildEventWithoutLocation();
  const ap = new EventObject(calendar, event).toActivityPubObject();
  expect(ap['pavillion:place']).toBeUndefined();
});
```

- [ ] **Step 2: Run, see fail**

- [ ] **Step 3: Implement the emission**

In `src/server/activitypub/model/object/event.ts`, in `toActivityPubObject()` after the existing `pavillion:*` keys are added:

```typescript
// pavillion:place — structured Place with all translations, when location exists.
// `domain` MUST come from server config — never req.host (host-header spoofing risk).
if (event.location) {
  result['pavillion:place'] = {
    id: `https://${config.get('domain')}/calendars/${calendar.urlName}/places/${event.location.id}`,
    address: event.location.address,
    city: event.location.city,
    state: event.location.state,
    postalCode: event.location.postalCode,
    country: event.location.country,
    content: Object.fromEntries(
      Object.entries(event.location._content).map(([lang, c]) => [
        lang,
        { name: event.location.name, accessibilityInfo: c.accessibilityInfo },
      ]),
    ),
  };
}
```

- [ ] **Step 4: Run, see pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/activitypub/model/object/event.ts src/server/activitypub/test/events.test.ts
git commit -m "feat(activitypub): emit pavillion:place extension on outbound events"
```

## Task 2.4: AP outbound — emit `pavillion:space`

**Files:**
- Modify: `src/server/activitypub/model/object/event.ts`
- Modify: `src/server/activitypub/test/events.test.ts`

- [ ] **Step 1: Add failing test**

```typescript
it('toActivityPubObject emits pavillion:space when event has Space, with full per-language content', () => {
  const event = buildEventWithPlaceAndSpace({
    placeName: 'Convention Center',
    spaceContent: {
      en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
      fr: { name: 'Salle Pacifique', accessibilityInfo: 'Boucle auditive' },
    },
  });
  const ap = new EventObject(calendar, event).toActivityPubObject();

  expect(ap['pavillion:space'].id).toMatch(/\/places\/[a-f0-9-]+\/spaces\/[a-f0-9-]+$/);
  expect(ap['pavillion:space'].content.en.name).toBe('Pacific Room');
  expect(ap['pavillion:space'].content.fr.name).toBe('Salle Pacifique');
  expect(ap['pavillion:space'].content.en.accessibilityInfo).toBe('Hearing loop');
});

it('toActivityPubObject does not emit pavillion:space for whole-venue events', () => {
  const event = buildEventWithPlaceOnly({ placeName: 'Convention Center' });
  const ap = new EventObject(calendar, event).toActivityPubObject();
  expect(ap['pavillion:space']).toBeUndefined();
});

it('flat as:Place.name concatenates Place + Space when Space is present', () => {
  const event = buildEventWithPlaceAndSpace({
    placeName: 'Convention Center',
    spaceName: 'Pacific Room',
  });
  const ap = new EventObject(calendar, event).toActivityPubObject();
  expect(ap.location.name).toBe('Convention Center — Pacific Room');
});
```

- [ ] **Step 2: Run, see fail**

- [ ] **Step 3: Implement Space emission**

In `toActivityPubObject()`:

```typescript
if (event.space) {
  result['pavillion:space'] = {
    id: `https://${domain}/calendars/${calendar.urlName}/places/${event.location!.id}/spaces/${event.space.id}`,
    content: Object.fromEntries(
      Object.entries(event.space._content).map(([lang, c]) => [
        lang,
        { name: c.name, accessibilityInfo: c.accessibilityInfo },
      ]),
    ),
  };
}
```

In `_buildLocation()`, when `event.space` is present, change the flat `name` field to concatenate (using the same primary-language pick used for event content):

```typescript
const placeName = location.name;
if (event.space) {
  const primaryLang = primaryLanguageFor(event.space._content, 'en');
  const spaceName = event.space._content[primaryLang]?.name || '';
  if (spaceName) {
    place.name = `${placeName} — ${spaceName}`;
  } else {
    place.name = placeName;
  }
}
```

(The `_buildLocation` may need the event passed in to access the Space; refactor signature as needed.)

- [ ] **Step 4: Run, see pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/activitypub/model/object/event.ts src/server/activitypub/test/events.test.ts
git commit -m "feat(activitypub): emit pavillion:space and concatenate flat Place name"
```

## Task 2.5: AP inbound — consume `pavillion:place` / `pavillion:space` with priority

**Files:**
- Modify: `src/server/activitypub/model/object/event.ts`
- Modify: `src/server/activitypub/test/events.test.ts`

**WIRE SHAPE NOTE (2026-05-05 update):** Per Option B decision, `pavillion:place.content[lang].name` is the source of `EventLocation.name`. Inbound parsing reads from there, picking the first available content entry (or a preferred-language pick if the calling context can supply one). The mismatched-parent defense logs a structured warning instead of dropping silently.

- [ ] **Step 1: Add failing tests**

```typescript
it('fromActivityPubObject prefers pavillion:place over standard as:Place.location', () => {
  const apObject = {
    type: 'Event',
    location: { type: 'Place', name: 'Convention Center — Pacific Room' },
    'pavillion:place': {
      id: 'https://other.example/calendars/x/places/abc',
      address: '100 Main St',
      content: {
        en: { name: 'Convention Center', accessibilityInfo: 'Accessible parking' },
      },
    },
    'pavillion:space': {
      id: 'https://other.example/calendars/x/places/abc/spaces/xyz',
      content: { en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' } },
    },
  };
  const result = EventObject.fromActivityPubObject(apObject);
  expect(result.location.name).toBe('Convention Center');
  expect(result.location.originUri).toBe('https://other.example/calendars/x/places/abc');
  expect(result.location.content.en.accessibilityInfo).toBe('Accessible parking');
  expect(result.space.originUri).toBe('https://other.example/calendars/x/places/abc/spaces/xyz');
  expect(result.space.content.en.name).toBe('Pacific Room');
});

it('fromActivityPubObject falls back to flat as:Place when extension absent', () => {
  const apObject = {
    type: 'Event',
    location: { type: 'Place', name: 'Some Venue', address: { streetAddress: '123 Foo St' } },
  };
  const result = EventObject.fromActivityPubObject(apObject);
  expect(result.location.name).toBe('Some Venue');
  expect(result.space).toBeFalsy();
});

it('fromActivityPubObject sanitizes HTML in extension content (name AND accessibilityInfo)', () => {
  const apObject = {
    type: 'Event',
    'pavillion:place': {
      id: 'https://x/y',
      content: {
        en: {
          name: '<b>Place</b>',
          accessibilityInfo: '<script>alert(1)</script>info',
        },
      },
    },
  };
  const result = EventObject.fromActivityPubObject(apObject);
  expect(result.location.name).toBe('Place');
  expect(result.location.content.en.accessibilityInfo).toBe('info');
});

it('fromActivityPubObject drops Space and logs structured warning when parent path mismatches', () => {
  const logSpy = sandbox.spy(log, 'warn'); // adapt to actual logger import
  const apObject = {
    id: 'https://other.example/activities/123',
    type: 'Event',
    'pavillion:place': {
      id: 'https://x/calendars/c/places/abc',
      content: { en: { name: 'Place' } },
    },
    'pavillion:space': {
      id: 'https://x/calendars/c/places/DIFFERENT/spaces/xyz',
      content: { en: { name: 'Room' } },
    },
  };
  const result = EventObject.fromActivityPubObject(apObject);
  expect(result.location.name).toBe('Place');
  expect(result.space).toBeFalsy();
  expect(logSpy.calledOnce).toBe(true);
  // structural identifiers only — no content fields in the log payload
  const logArgs = logSpy.firstCall.args[1];
  expect(logArgs.placeId).toBe('https://x/calendars/c/places/abc');
  expect(logArgs.spaceId).toBe('https://x/calendars/c/places/DIFFERENT/spaces/xyz');
  expect(logArgs.name).toBeUndefined();
});

it('fromActivityPubObject drops Space and falls through to flat path when pavillion:place absent', () => {
  const apObject = {
    type: 'Event',
    location: { type: 'Place', name: 'Flat Place' },
    'pavillion:space': {
      id: 'https://x/calendars/c/places/abc/spaces/xyz',
      content: { en: { name: 'Orphan Space' } },
    },
  };
  const result = EventObject.fromActivityPubObject(apObject);
  expect(result.location.name).toBe('Flat Place');
  expect(result.space).toBeFalsy();
});
```

- [ ] **Step 2: Run, see fail**

- [ ] **Step 3: Implement priority consumption in `fromActivityPubObject`**

In `EventObject.fromActivityPubObject`, replace the existing single `result.location = _normalizeLocation(...)` block with:

```typescript
const placeExt = apObject['pavillion:place'];
const spaceExt = apObject['pavillion:space'];

if (placeExt && typeof placeExt === 'object') {
  const sanitizedContent = EventObject._sanitizeLocationContent(placeExt.content ?? {});
  // Pick the first available content entry's name to populate the local single-string EventLocation.name.
  // Today every entry carries the same name; when Place names later become translatable, this becomes
  // a real per-language population.
  const firstEntry = Object.values(sanitizedContent)[0] as { name?: string } | undefined;
  const placeName = firstEntry?.name ?? '';

  result.location = {
    name: placeName,
    address: stripHtmlTags(placeExt.address ?? ''),
    city: stripHtmlTags(placeExt.city ?? ''),
    state: stripHtmlTags(placeExt.state ?? ''),
    postalCode: stripHtmlTags(placeExt.postalCode ?? ''),
    country: stripHtmlTags(placeExt.country ?? ''),
    originUri: typeof placeExt.id === 'string' ? placeExt.id : null,
    content: sanitizedContent,
  };

  if (spaceExt && typeof spaceExt === 'object') {
    // Validate parent path consistency
    const placeId = typeof placeExt.id === 'string' ? placeExt.id : '';
    const spaceId = typeof spaceExt.id === 'string' ? spaceExt.id : '';
    const parentMatches = spaceId.startsWith(placeId + '/spaces/');
    if (parentMatches) {
      result.space = {
        originUri: spaceId,
        content: EventObject._sanitizeSpaceContent(spaceExt.content ?? {}),
      };
    } else {
      // Structured warning — admin-observable signal of buggy or hostile peer.
      // Log structural identifiers ONLY; never log content fields.
      log.warn('pavillion:space dropped — parent mismatch', {
        activityId: apObject.id,
        senderDomain: /* extract from activity */,
        placeId,
        spaceId,
      });
    }
  }
}
else if (apObject.location !== undefined) {
  result.location = EventObject._normalizeLocation(apObject.location);
}
// If pavillion:space arrives without pavillion:place, ignore the orphan space
// and fall through to the flat _normalizeLocation path above (already covered
// by the else-if branch).
```

Add the two new sanitizer helpers next to `_sanitizeContentObject`. Note: `_sanitizeLocationContent` strips HTML from BOTH `name` and `accessibilityInfo` per entry now (Place name moved into per-language content per Option B):

```typescript
private static _sanitizeLocationContent(content: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [lang, entry] of Object.entries(content)) {
    if (entry && typeof entry === 'object') {
      const e = entry as any;
      out[lang] = {
        name: typeof e.name === 'string' ? stripHtmlTags(e.name) : '',
        accessibilityInfo: typeof e.accessibilityInfo === 'string'
          ? stripHtmlTags(e.accessibilityInfo)
          : '',
      };
    }
  }
  return out;
}

private static _sanitizeSpaceContent(content: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [lang, entry] of Object.entries(content)) {
    if (entry && typeof entry === 'object') {
      const e = entry as any;
      out[lang] = {
        name: typeof e.name === 'string' ? stripHtmlTags(e.name) : '',
        accessibilityInfo: typeof e.accessibilityInfo === 'string' ? stripHtmlTags(e.accessibilityInfo) : '',
      };
    }
  }
  return out;
}
```

- [ ] **Step 4: Run, see pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/activitypub/model/object/event.ts src/server/activitypub/test/events.test.ts
git commit -m "feat(activitypub): consume pavillion:place/space inbound with priority and dedup hint"
```

## Task 2.6: Service-layer dedup by `origin_uri`

**Files:**
- Modify: `src/server/calendar/service/locations.ts`
- Modify: `src/server/activitypub/service/inbox.ts` (or wherever inbound events become Place/Space records)
- Test: existing inbox test file

- [ ] **Step 1: Identify the inbound event-to-location code path**

Run: `grep -rn "findOrCreateLocation\|_normalizeLocation" src/server/activitypub src/server/calendar | head`
Find where inbound `result.location` from `fromActivityPubObject` becomes a persisted `EventLocation`.

- [ ] **Step 2: Add failing test**

When the same `pavillion:place.id` arrives in two events, assert that only one `LocationEntity` row exists after both have been processed; the second event reuses the first's Place. Same for Space.

- [ ] **Step 3: Add `findOrCreateByOriginUri` helper to LocationsService**

```typescript
async findOrCreatePlaceByOriginUri(
  calendar: Calendar,
  originUri: string,
  data: { name: string; address?: string; ...; content: Record<string, { accessibilityInfo: string }> },
): Promise<EventLocation> {
  const existing = await LocationEntity.findOne({
    where: { calendar_id: calendar.id, origin_uri: originUri },
    include: [LocationContentEntity],
  });
  if (existing) {
    return existing.toModel();
  }
  // Create new with origin_uri
  const created = await LocationEntity.create({
    id: uuidv4(),
    calendar_id: calendar.id,
    origin_uri: originUri,
    name: data.name,
    address: data.address ?? '',
    // ...
  });
  for (const [lang, c] of Object.entries(data.content)) {
    await LocationContentEntity.create({
      location_id: created.id,
      language: lang,
      accessibility_info: c.accessibilityInfo,
    });
  }
  return (await LocationEntity.findByPk(created.id, { include: [LocationContentEntity] }))!.toModel();
}
```

Add equivalent `findOrCreateSpaceByOriginUri(calendar, place, originUri, data)`.

- [ ] **Step 4: Wire into inbound path**

Where the inbox currently creates a `LocationEntity` from `result.location`, branch on `result.location.originUri`: when present, route through `findOrCreatePlaceByOriginUri`; when absent, use the existing flat-create code unchanged. Same for Space.

- [ ] **Step 5: Run, see pass**

- [ ] **Step 6: Commit**

```bash
git add src/server/calendar/service/locations.ts src/server/activitypub/service/inbox.ts src/server/activitypub/test/
git commit -m "feat(activitypub): dedup AP-originated Places/Spaces by origin_uri"
```

## Task 2.7: AP round-trip integration test

**Files:**
- Modify: `src/server/activitypub/test/events.test.ts`

- [ ] **Step 1: Add a round-trip test**

```typescript
it('round-trips Place + Space + multilingual content via AP serialization', () => {
  const event = buildEventWithPlaceAndSpace({
    placeName: 'Convention Center',
    address: '100 Main St',
    placeAccessibility: { en: 'Accessible parking', fr: 'Stationnement accessible' },
    spaceContent: {
      en: { name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
      fr: { name: 'Salle Pacifique', accessibilityInfo: 'Boucle auditive' },
    },
  });

  const apObject = new EventObject(calendar, event).toActivityPubObject();
  const restored = EventObject.fromActivityPubObject(apObject);

  // Structured Place name comes back from content[lang].name (NOT from the concatenated flat as:Place.name).
  expect(restored.location).not.toBeNull();
  expect(restored.location.name).toBe('Convention Center');
  expect(restored.location.address).toBe('100 Main St');
  // Per Option B, content[lang].name is present in every language entry alongside accessibilityInfo.
  expect(restored.location.content.en.name).toBe('Convention Center');
  expect(restored.location.content.fr.name).toBe('Convention Center');
  expect(restored.location.content.en.accessibilityInfo).toBe('Accessible parking');
  expect(restored.location.content.fr.accessibilityInfo).toBe('Stationnement accessible');
  expect(restored.space).not.toBeNull();
  expect(restored.space.content.en.name).toBe('Pacific Room');
  expect(restored.space.content.fr.name).toBe('Salle Pacifique');
  expect(restored.space.content.fr.accessibilityInfo).toBe('Boucle auditive');
});
```

- [ ] **Step 2: Run, see pass** (it should pass given Tasks 2.3–2.5 are correct)

- [ ] **Step 3: Commit**

```bash
git add src/server/activitypub/test/events.test.ts
git commit -m "test(activitypub): round-trip Place + Space + multilingual content"
```

---

## Self-Review

**Spec coverage:**

- Domain model (Place + Space + content) — Tasks 1.1–1.6 ✓
- `SpaceLocationMismatchError` — Task 1.7 ✓
- Service-layer Space CRUD + cascade — Tasks 1.8–1.9 ✓
- Events service invariant — Task 1.10 ✓
- REST API (Space CRUD + event spaceId) — Tasks 1.11–1.12 ✓
- Public API `space` field — Task 1.13 ✓
- Frontend service/store — Task 1.14 ✓
- i18n keys — Task 1.15 ✓
- edit-place Spaces section — Task 1.16 ✓
- Picker flatten — Task 1.17 ✓
- Display layered accessibility — Task 1.18 ✓
- E2E — Task 1.19 ✓
- AP `origin_uri` schema — Task 2.1–2.2 ✓
- AP outbound `pavillion:place`/`pavillion:space` — Tasks 2.3–2.4 ✓
- AP inbound active priority + sanitization + defensive degradation — Task 2.5 ✓
- AP service-layer dedup — Task 2.6 ✓
- AP round-trip — Task 2.7 ✓
- Operational manual cleanup of pre-existing flat-named Places — covered in spec, no plan task needed (manual)
- Out-of-scope items (Place name translation, three-level nesting, Space-specific address/coords/capacity, dereferenceable AP Place objects, JSON-LD `@context` registration, bulk migration tool) — explicitly deferred ✓

**Placeholder scan:** All "(or check file path)" notes are explicit reminders to confirm-against-real-codebase, not deferred decisions. Each task has actual code or actual commands. No "TBD" left in the plan body.

**Type consistency:**
- `EventLocationSpace` and `EventLocationSpaceContent` names used consistently throughout.
- `space_id` (entity column) ↔ `spaceId` (model field) ↔ `space.id` (object property) consistent.
- `origin_uri` (column) ↔ `originUri` (model field) consistent.
- `place.id` URL pattern used consistently in AP id minting.
