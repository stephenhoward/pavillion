import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';

describe('EventReporterEntity', () => {
  beforeAll(async () => {
    await db.sync({ force: true });
  });

  it('stamps created_at when a row is saved', async () => {
    const entity = EventReporterEntity.fromModel({
      eventId: uuidv4(),
      reporterIdentifier: 'reporter-hash',
      reportId: uuidv4(),
    });

    await entity.save();

    expect(entity.created_at).toBeInstanceOf(Date);

    const found = await EventReporterEntity.findByPk(entity.id);
    expect(found?.created_at).toBeInstanceOf(Date);
  });
});
