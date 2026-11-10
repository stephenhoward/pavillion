import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import db from '@/server/common/entity/db';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';

describe('ReportEscalationEntity', () => {
  beforeAll(async () => {
    await db.sync({ force: true });
  });

  it('stamps created_at when a row is saved', async () => {
    const entity = ReportEscalationEntity.fromModel({
      reportId: uuidv4(),
      fromStatus: 'submitted',
      toStatus: 'escalated',
      reviewerRole: 'owner',
      decision: 'escalated',
    });

    await entity.save();

    expect(entity.created_at).toBeInstanceOf(Date);

    const found = await ReportEscalationEntity.findByPk(entity.id);
    expect(found?.created_at).toBeInstanceOf(Date);
    expect(found?.toModel().createdAt).toBeInstanceOf(Date);
  });
});
