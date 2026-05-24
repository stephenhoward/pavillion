import { describe, it, expect } from 'vitest';
import { NotificationActivityEntity } from '@/server/notifications/entity/notification_activity';

describe('NotificationActivityEntity column mapping', () => {
  const sampleEntityData = {
    id: 'activity-123',
    verb: 'Follow',
    origin: 'federated',
    actor_kind: 'remote_actor',
    actor_account_id: null as string | null,
    actor_uri: 'https://remote.example/users/alice',
    actor_display_name: 'Alice',
    actor_display_url: 'https://remote.example/users/alice',
    object_type: 'calendar',
    object_id: 'cal-456',
    object_label: 'Summer Concerts',
    created_at: new Date('2026-05-22T12:00:00Z'),
  };

  it('preserves all populated column values on build', () => {
    const entity = NotificationActivityEntity.build(sampleEntityData);

    expect(entity.id).toBe('activity-123');
    expect(entity.verb).toBe('Follow');
    expect(entity.origin).toBe('federated');
    expect(entity.actor_kind).toBe('remote_actor');
    expect(entity.actor_account_id).toBeNull();
    expect(entity.actor_uri).toBe('https://remote.example/users/alice');
    expect(entity.actor_display_name).toBe('Alice');
    expect(entity.actor_display_url).toBe('https://remote.example/users/alice');
    expect(entity.object_type).toBe('calendar');
    expect(entity.object_id).toBe('cal-456');
    expect(entity.object_label).toBe('Summer Concerts');
    expect(entity.created_at).toEqual(new Date('2026-05-22T12:00:00Z'));
  });

  it('preserves nulls (not undefined) for the Flag row shape', () => {
    const flagData = {
      ...sampleEntityData,
      verb: 'Flag',
      actor_kind: 'anonymous',
      actor_account_id: null,
      actor_uri: null,
      actor_display_name: 'Anonymous reporter',
      actor_display_url: null,
      object_type: 'report',
      object_id: 'report-789',
      object_label: 'Event title that was flagged',
    };

    const entity = NotificationActivityEntity.build(flagData);

    expect(entity.verb).toBe('Flag');
    expect(entity.actor_kind).toBe('anonymous');
    expect(entity.actor_account_id).toBeNull();
    expect(entity.actor_uri).toBeNull();
    expect(entity.actor_display_url).toBeNull();
    expect(entity.actor_display_name).toBe('Anonymous reporter');
    expect(entity.object_type).toBe('report');
    expect(entity.object_id).toBe('report-789');
    expect(entity.object_label).toBe('Event title that was flagged');
  });

  it('preserves a local-account actor shape', () => {
    const localData = {
      ...sampleEntityData,
      verb: 'EditorInvited',
      origin: 'local',
      actor_kind: 'account',
      actor_account_id: 'account-aaa',
      actor_uri: null,
      actor_display_name: 'Bob',
      actor_display_url: null,
    };

    const entity = NotificationActivityEntity.build(localData);

    expect(entity.verb).toBe('EditorInvited');
    expect(entity.origin).toBe('local');
    expect(entity.actor_kind).toBe('account');
    expect(entity.actor_account_id).toBe('account-aaa');
    expect(entity.actor_uri).toBeNull();
    expect(entity.actor_display_url).toBeNull();
  });
});
