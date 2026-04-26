import { describe, it, expect, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { BlockedInstance } from '@/common/model/blocked_instance';
import { BlockedInstanceEntity } from '@/server/moderation/entity/blocked_instance';

describe('BlockedInstanceEntity', () => {

  afterEach(() => {
    // Clean up any test data if needed
  });

  describe('fromModel', () => {
    it('should create entity from a BlockedInstance model', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();
      const blockedAt = new Date('2026-02-10T08:00:00Z');

      const model = new BlockedInstance(id);
      model.domain = 'bad-instance.example.com';
      model.reason = 'Repeated policy violations';
      model.blockedAt = blockedAt;
      model.blockedBy = blockedBy;

      const entity = BlockedInstanceEntity.fromModel(model);

      expect(entity.id).toBe(id);
      expect(entity.domain).toBe('bad-instance.example.com');
      expect(entity.reason).toBe('Repeated policy violations');
      expect(entity.blocked_at).toEqual(blockedAt);
      expect(entity.blocked_by).toBe(blockedBy);
    });

    it('should handle different domains and reasons', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();

      const model = new BlockedInstance(id);
      model.domain = 'spam-central.test';
      model.reason = 'Automated spam distribution';
      model.blockedAt = new Date();
      model.blockedBy = blockedBy;

      const entity = BlockedInstanceEntity.fromModel(model);

      expect(entity.domain).toBe('spam-central.test');
      expect(entity.reason).toBe('Automated spam distribution');
    });
  });

  describe('toModel', () => {
    it('should convert entity to BlockedInstance model', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();
      const blockedAt = new Date('2026-02-10T08:00:00Z');

      const model = new BlockedInstance(id);
      model.domain = 'malicious.example.org';
      model.reason = 'Hosting illegal content';
      model.blockedAt = blockedAt;
      model.blockedBy = blockedBy;

      const entity = BlockedInstanceEntity.fromModel(model);
      const convertedModel = entity.toModel();

      expect(convertedModel).toBeInstanceOf(BlockedInstance);
      expect(convertedModel.id).toBe(id);
      expect(convertedModel.domain).toBe('malicious.example.org');
      expect(convertedModel.reason).toBe('Hosting illegal content');
      expect(convertedModel.blockedAt).toEqual(blockedAt);
      expect(convertedModel.blockedBy).toBe(blockedBy);
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain data integrity through model-entity-model conversion', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();
      const blockedAt = new Date('2026-02-10T08:00:00Z');

      const originalModel = new BlockedInstance(id);
      originalModel.domain = 'test-domain.example.com';
      originalModel.reason = 'Testing round-trip conversion';
      originalModel.blockedAt = blockedAt;
      originalModel.blockedBy = blockedBy;

      const entity = BlockedInstanceEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.domain).toBe(originalModel.domain);
      expect(roundTripModel.reason).toBe(originalModel.reason);
      expect(roundTripModel.blockedAt).toEqual(originalModel.blockedAt);
      expect(roundTripModel.blockedBy).toBe(originalModel.blockedBy);
    });

    it('should handle model with default timestamps', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();

      const originalModel = new BlockedInstance(id);
      originalModel.domain = 'another-bad.example.net';
      originalModel.reason = 'Community standards violation';
      // blockedAt will be default new Date()
      originalModel.blockedBy = blockedBy;

      const entity = BlockedInstanceEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.domain).toBe(originalModel.domain);
      expect(roundTripModel.reason).toBe(originalModel.reason);
      expect(roundTripModel.blockedAt.getTime()).toBeCloseTo(originalModel.blockedAt.getTime(), -2);
      expect(roundTripModel.blockedBy).toBe(originalModel.blockedBy);
    });
  });
});
