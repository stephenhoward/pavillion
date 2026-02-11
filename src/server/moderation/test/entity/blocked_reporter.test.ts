import { describe, it, expect, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { BlockedReporter } from '@/common/model/blocked_reporter';
import { BlockedReporterEntity } from '@/server/moderation/entity/blocked_reporter';

describe('BlockedReporterEntity', () => {

  afterEach(() => {
    // Clean up any test data if needed
  });

  describe('fromModel', () => {
    it('should create entity from a BlockedReporter model', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();
      const createdAt = new Date('2026-02-10T08:00:00Z');

      const model = new BlockedReporter(id);
      model.emailHash = 'abc123def456';
      model.reason = 'Repeated spam reports';
      model.createdAt = createdAt;
      model.blockedBy = blockedBy;

      const entity = BlockedReporterEntity.fromModel(model);

      expect(entity.id).toBe(id);
      expect(entity.email_hash).toBe('abc123def456');
      expect(entity.reason).toBe('Repeated spam reports');
      expect(entity.created_at).toEqual(createdAt);
      expect(entity.blocked_by).toBe(blockedBy);
    });

    it('should handle different email hashes and reasons', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();

      const model = new BlockedReporter(id);
      model.emailHash = 'xyz789uvw012';
      model.reason = 'Abusive language in reports';
      model.createdAt = new Date();
      model.blockedBy = blockedBy;

      const entity = BlockedReporterEntity.fromModel(model);

      expect(entity.email_hash).toBe('xyz789uvw012');
      expect(entity.reason).toBe('Abusive language in reports');
    });
  });

  describe('toModel', () => {
    it('should convert entity to BlockedReporter model', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();
      const createdAt = new Date('2026-02-10T08:00:00Z');

      const model = new BlockedReporter(id);
      model.emailHash = 'hash123abc456';
      model.reason = 'Coordinated harassment campaign';
      model.createdAt = createdAt;
      model.blockedBy = blockedBy;

      const entity = BlockedReporterEntity.fromModel(model);
      const convertedModel = entity.toModel();

      expect(convertedModel).toBeInstanceOf(BlockedReporter);
      expect(convertedModel.id).toBe(id);
      expect(convertedModel.emailHash).toBe('hash123abc456');
      expect(convertedModel.reason).toBe('Coordinated harassment campaign');
      expect(convertedModel.createdAt).toEqual(createdAt);
      expect(convertedModel.blockedBy).toBe(blockedBy);
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain data integrity through model-entity-model conversion', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();
      const createdAt = new Date('2026-02-10T08:00:00Z');

      const originalModel = new BlockedReporter(id);
      originalModel.emailHash = 'testHash123456';
      originalModel.reason = 'Testing round-trip conversion';
      originalModel.createdAt = createdAt;
      originalModel.blockedBy = blockedBy;

      const entity = BlockedReporterEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.emailHash).toBe(originalModel.emailHash);
      expect(roundTripModel.reason).toBe(originalModel.reason);
      expect(roundTripModel.createdAt).toEqual(originalModel.createdAt);
      expect(roundTripModel.blockedBy).toBe(originalModel.blockedBy);
    });

    it('should handle model with default timestamps', () => {
      const id = uuidv4();
      const blockedBy = uuidv4();

      const originalModel = new BlockedReporter(id);
      originalModel.emailHash = 'defaultTimeHash';
      originalModel.reason = 'Policy violation';
      // createdAt will be default new Date()
      originalModel.blockedBy = blockedBy;

      const entity = BlockedReporterEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.emailHash).toBe(originalModel.emailHash);
      expect(roundTripModel.reason).toBe(originalModel.reason);
      expect(roundTripModel.createdAt.getTime()).toBeCloseTo(originalModel.createdAt.getTime(), -2);
      expect(roundTripModel.blockedBy).toBe(originalModel.blockedBy);
    });
  });
});
