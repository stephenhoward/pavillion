import { describe, it, expect, afterEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { ReportEntity } from '@/server/moderation/entity/report';

describe('ReportEntity', () => {

  afterEach(() => {
    // Clean up any test data if needed
  });

  describe('fromModel', () => {
    it('should create entity from a Report model', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();
      const createdAt = new Date('2026-02-10T08:00:00Z');
      const updatedAt = new Date('2026-02-10T09:00:00Z');

      const model = new Report(id);
      model.eventId = eventId;
      model.calendarId = calendarId;
      model.category = ReportCategory.SPAM;
      model.description = 'This event is spam';
      model.reporterEmailHash = 'abc123hash';
      model.reporterType = 'anonymous';
      model.status = ReportStatus.SUBMITTED;
      model.createdAt = createdAt;
      model.updatedAt = updatedAt;

      const entity = ReportEntity.fromModel(model);

      expect(entity.id).toBe(id);
      expect(entity.event_id).toBe(eventId);
      expect(entity.calendar_id).toBe(calendarId);
      expect(entity.category).toBe('spam');
      expect(entity.description).toBe('This event is spam');
      expect(entity.reporter_email_hash).toBe('abc123hash');
      expect(entity.reporter_type).toBe('anonymous');
      expect(entity.status).toBe('submitted');
    });

    it('should handle pattern indicator flags', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();

      const model = new Report(id);
      model.eventId = eventId;
      model.calendarId = calendarId;
      model.category = ReportCategory.SPAM;
      model.description = 'Pattern test';
      model.reporterType = 'anonymous';
      model.status = ReportStatus.SUBMITTED;
      model.hasSourceFloodingPattern = true;
      model.hasEventTargetingPattern = false;
      model.hasInstancePattern = true;

      const entity = ReportEntity.fromModel(model);

      expect(entity.has_source_flooding_pattern).toBe(true);
      expect(entity.has_event_targeting_pattern).toBe(false);
      expect(entity.has_instance_pattern).toBe(true);
    });

    it('should default pattern flags to false when not set', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();

      const model = new Report(id);
      model.eventId = eventId;
      model.calendarId = calendarId;
      model.category = ReportCategory.OTHER;
      model.description = 'No patterns';
      model.reporterType = 'anonymous';
      model.status = ReportStatus.PENDING_VERIFICATION;

      const entity = ReportEntity.fromModel(model);

      expect(entity.has_source_flooding_pattern).toBe(false);
      expect(entity.has_event_targeting_pattern).toBe(false);
      expect(entity.has_instance_pattern).toBe(false);
    });
  });

  describe('toModel', () => {
    it('should convert entity to Report model', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();
      const createdAt = new Date('2026-02-10T08:00:00Z');
      const updatedAt = new Date('2026-02-10T09:00:00Z');

      const model = new Report(id);
      model.eventId = eventId;
      model.calendarId = calendarId;
      model.category = ReportCategory.HARASSMENT;
      model.description = 'Harassing content';
      model.reporterEmailHash = 'hash123abc';
      model.reporterType = 'authenticated';
      model.status = ReportStatus.UNDER_REVIEW;
      model.createdAt = createdAt;
      model.updatedAt = updatedAt;

      const entity = ReportEntity.fromModel(model);
      const convertedModel = entity.toModel();

      expect(convertedModel).toBeInstanceOf(Report);
      expect(convertedModel.id).toBe(id);
      expect(convertedModel.eventId).toBe(eventId);
      expect(convertedModel.calendarId).toBe(calendarId);
      expect(convertedModel.category).toBe(ReportCategory.HARASSMENT);
      expect(convertedModel.description).toBe('Harassing content');
      expect(convertedModel.reporterEmailHash).toBe('hash123abc');
      expect(convertedModel.reporterType).toBe('authenticated');
      expect(convertedModel.status).toBe(ReportStatus.UNDER_REVIEW);
      expect(convertedModel.createdAt).toEqual(createdAt);
      expect(convertedModel.updatedAt).toEqual(updatedAt);
    });

    it('should convert pattern indicator flags from entity to model', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();

      const model = new Report(id);
      model.eventId = eventId;
      model.calendarId = calendarId;
      model.category = ReportCategory.SPAM;
      model.description = 'Pattern test';
      model.reporterType = 'anonymous';
      model.status = ReportStatus.SUBMITTED;
      model.hasSourceFloodingPattern = true;
      model.hasEventTargetingPattern = true;
      model.hasInstancePattern = false;

      const entity = ReportEntity.fromModel(model);
      const convertedModel = entity.toModel();

      expect(convertedModel.hasSourceFloodingPattern).toBe(true);
      expect(convertedModel.hasEventTargetingPattern).toBe(true);
      expect(convertedModel.hasInstancePattern).toBe(false);
    });
  });

  describe('round-trip conversion', () => {
    it('should maintain data integrity through model-entity-model conversion', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();
      const adminId = uuidv4();
      const reviewerId = uuidv4();
      const createdAt = new Date('2026-02-10T08:00:00Z');
      const updatedAt = new Date('2026-02-10T09:00:00Z');
      const reviewerTimestamp = new Date('2026-02-10T10:00:00Z');

      const originalModel = new Report(id);
      originalModel.eventId = eventId;
      originalModel.calendarId = calendarId;
      originalModel.category = ReportCategory.MISLEADING;
      originalModel.description = 'Misleading information';
      originalModel.reporterEmailHash = 'testHash123';
      originalModel.reporterAccountId = null;
      originalModel.reporterType = 'anonymous';
      originalModel.adminId = adminId;
      originalModel.adminPriority = 'high';
      originalModel.status = ReportStatus.ESCALATED;
      originalModel.reviewerId = reviewerId;
      originalModel.reviewerNotes = 'Confirmed misleading';
      originalModel.reviewerTimestamp = reviewerTimestamp;
      originalModel.escalationType = 'automatic';
      originalModel.hasSourceFloodingPattern = true;
      originalModel.hasEventTargetingPattern = false;
      originalModel.hasInstancePattern = true;
      originalModel.createdAt = createdAt;
      originalModel.updatedAt = updatedAt;

      const entity = ReportEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.id).toBe(originalModel.id);
      expect(roundTripModel.eventId).toBe(originalModel.eventId);
      expect(roundTripModel.calendarId).toBe(originalModel.calendarId);
      expect(roundTripModel.category).toBe(originalModel.category);
      expect(roundTripModel.description).toBe(originalModel.description);
      expect(roundTripModel.reporterEmailHash).toBe(originalModel.reporterEmailHash);
      expect(roundTripModel.reporterAccountId).toBe(originalModel.reporterAccountId);
      expect(roundTripModel.reporterType).toBe(originalModel.reporterType);
      expect(roundTripModel.adminId).toBe(originalModel.adminId);
      expect(roundTripModel.adminPriority).toBe(originalModel.adminPriority);
      expect(roundTripModel.status).toBe(originalModel.status);
      expect(roundTripModel.reviewerId).toBe(originalModel.reviewerId);
      expect(roundTripModel.reviewerNotes).toBe(originalModel.reviewerNotes);
      expect(roundTripModel.reviewerTimestamp).toEqual(originalModel.reviewerTimestamp);
      expect(roundTripModel.escalationType).toBe(originalModel.escalationType);
      expect(roundTripModel.hasSourceFloodingPattern).toBe(originalModel.hasSourceFloodingPattern);
      expect(roundTripModel.hasEventTargetingPattern).toBe(originalModel.hasEventTargetingPattern);
      expect(roundTripModel.hasInstancePattern).toBe(originalModel.hasInstancePattern);
      expect(roundTripModel.createdAt).toEqual(originalModel.createdAt);
      expect(roundTripModel.updatedAt).toEqual(originalModel.updatedAt);
    });

    it('should handle model with all pattern flags set to true', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();

      const originalModel = new Report(id);
      originalModel.eventId = eventId;
      originalModel.calendarId = calendarId;
      originalModel.category = ReportCategory.SPAM;
      originalModel.description = 'All patterns detected';
      originalModel.reporterType = 'anonymous';
      originalModel.status = ReportStatus.SUBMITTED;
      originalModel.hasSourceFloodingPattern = true;
      originalModel.hasEventTargetingPattern = true;
      originalModel.hasInstancePattern = true;

      const entity = ReportEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.hasSourceFloodingPattern).toBe(true);
      expect(roundTripModel.hasEventTargetingPattern).toBe(true);
      expect(roundTripModel.hasInstancePattern).toBe(true);
    });

    it('should handle model with all pattern flags set to false', () => {
      const id = uuidv4();
      const eventId = uuidv4();
      const calendarId = uuidv4();

      const originalModel = new Report(id);
      originalModel.eventId = eventId;
      originalModel.calendarId = calendarId;
      originalModel.category = ReportCategory.OTHER;
      originalModel.description = 'No patterns';
      originalModel.reporterType = 'anonymous';
      originalModel.status = ReportStatus.SUBMITTED;
      originalModel.hasSourceFloodingPattern = false;
      originalModel.hasEventTargetingPattern = false;
      originalModel.hasInstancePattern = false;

      const entity = ReportEntity.fromModel(originalModel);
      const roundTripModel = entity.toModel();

      expect(roundTripModel.hasSourceFloodingPattern).toBe(false);
      expect(roundTripModel.hasEventTargetingPattern).toBe(false);
      expect(roundTripModel.hasInstancePattern).toBe(false);
    });
  });
});
