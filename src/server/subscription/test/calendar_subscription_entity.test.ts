import { describe, it, expect, beforeEach } from 'vitest';
import { CalendarSubscriptionEntity } from '@/server/subscription/entity/calendar_subscription';

describe('CalendarSubscriptionEntity', () => {
  let sampleData: any;

  beforeEach(() => {
    sampleData = {
      id: 'calsub-123',
      subscription_id: 'sub-456',
      calendar_id: 'cal-789',
      amount: 500000, // $5.00 in millicents
      end_time: null,
      created_at: new Date('2026-01-15'),
    };
  });

  it('should create entity with all fields', () => {
    const entity = CalendarSubscriptionEntity.build(sampleData);

    expect(entity.id).toBe(sampleData.id);
    expect(entity.subscription_id).toBe(sampleData.subscription_id);
    expect(entity.calendar_id).toBe(sampleData.calendar_id);
    expect(entity.amount).toBe(sampleData.amount);
    expect(entity.end_time).toBeNull();
    expect(entity.created_at).toEqual(sampleData.created_at);
  });

  it('should create entity with null end_time indicating active allocation', () => {
    const entity = CalendarSubscriptionEntity.build(sampleData);

    expect(entity.end_time).toBeNull();
  });

  it('should create entity with future end_time indicating funded through that date', () => {
    const futureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const data = { ...sampleData, end_time: futureDate };

    const entity = CalendarSubscriptionEntity.build(data);

    expect(entity.end_time).toEqual(futureDate);
  });

  it('should create entity with past end_time indicating ended allocation', () => {
    const pastDate = new Date('2025-06-01');
    const data = { ...sampleData, end_time: pastDate };

    const entity = CalendarSubscriptionEntity.build(data);

    expect(entity.end_time).toEqual(pastDate);
  });

  it('should store amount as integer in millicents', () => {
    const entity = CalendarSubscriptionEntity.build(sampleData);

    expect(typeof entity.amount).toBe('number');
    expect(entity.amount).toBe(500000);
  });

  it('should require subscription_id and calendar_id', () => {
    const entity = CalendarSubscriptionEntity.build({
      id: 'calsub-abc',
      subscription_id: 'sub-1',
      calendar_id: 'cal-1',
      amount: 100000,
    });

    expect(entity.subscription_id).toBe('sub-1');
    expect(entity.calendar_id).toBe('cal-1');
  });
});
