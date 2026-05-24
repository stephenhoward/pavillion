import { describe, it, expect } from 'vitest';
// Import order matters: notification_activity registers both entities via
// db.addModels. Importing recipient first would cause a circular evaluation
// where NotificationRecipientEntity is undefined at addModels time.
import { NotificationActivityEntity } from '@/server/notifications/entity/notification_activity';
import { NotificationRecipientEntity } from '@/server/notifications/entity/notification_recipient';

// Silence the unused-import lint without losing the side-effect import.
void NotificationActivityEntity;

describe('NotificationRecipientEntity column mapping', () => {
  const baseData = {
    id: 'recipient-123',
    notification_activity_id: 'activity-456',
    account_id: 'account-789',
    seen_at: null as Date | null,
    dismissed_at: null as Date | null,
    created_at: new Date('2026-05-22T12:00:00Z'),
  };

  it('preserves all column values for an unseen, undismissed row', () => {
    const entity = NotificationRecipientEntity.build(baseData);

    expect(entity.id).toBe('recipient-123');
    expect(entity.notification_activity_id).toBe('activity-456');
    expect(entity.account_id).toBe('account-789');
    expect(entity.seen_at).toBeNull();
    expect(entity.dismissed_at).toBeNull();
    expect(entity.created_at).toEqual(new Date('2026-05-22T12:00:00Z'));
  });

  it('preserves seen_at when populated', () => {
    const entity = NotificationRecipientEntity.build({
      ...baseData,
      seen_at: new Date('2026-05-22T13:00:00Z'),
    });

    expect(entity.seen_at).toEqual(new Date('2026-05-22T13:00:00Z'));
    expect(entity.dismissed_at).toBeNull();
  });

  it('preserves dismissed_at when populated', () => {
    const entity = NotificationRecipientEntity.build({
      ...baseData,
      dismissed_at: new Date('2026-05-22T14:00:00Z'),
    });

    expect(entity.seen_at).toBeNull();
    expect(entity.dismissed_at).toEqual(new Date('2026-05-22T14:00:00Z'));
  });

  it('preserves both lifecycle timestamps when populated', () => {
    const entity = NotificationRecipientEntity.build({
      ...baseData,
      seen_at: new Date('2026-05-22T13:00:00Z'),
      dismissed_at: new Date('2026-05-22T14:00:00Z'),
    });

    expect(entity.seen_at).toEqual(new Date('2026-05-22T13:00:00Z'));
    expect(entity.dismissed_at).toEqual(new Date('2026-05-22T14:00:00Z'));
  });
});
