import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import { UniqueConstraintError } from 'sequelize';

import { Report, ReportCategory, ReportStatus } from '@/common/model/report';
import { DuplicateReportError, ReportValidationError } from '@/common/exceptions/report';
import { ReportEntity } from '@/server/moderation/entity/report';
import { EventReporterEntity } from '@/server/moderation/entity/event_reporter';
import { ReportEscalationEntity } from '@/server/moderation/entity/report_escalation';
import ModerationService from '@/server/moderation/service/moderation';
import { EventNotFoundError } from '@/common/exceptions/calendar';
import { ReportNotFoundError } from '@/server/moderation/exceptions';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import ActivityPubInterface from '@/server/activitypub/interface';
import { CalendarEvent } from '@/common/model/events';
import { Calendar } from '@/common/model/calendar';
import config from 'config';

/** A valid UUID v4 for use in tests. */
const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('ModerationService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: ModerationService;
  let eventBus: EventEmitter;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    eventBus = new EventEmitter();
    service = new ModerationService(eventBus);
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('validateReportFields', () => {

    it('should return no errors for valid input', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', 'Valid description');

      expect(errors).toHaveLength(0);
    });

    it('should return error when eventId is missing', () => {
      const errors = service.validateReportFields(undefined, 'spam', 'Description');

      expect(errors).toContain('Event ID is required');
    });

    it('should return error when eventId is empty string', () => {
      const errors = service.validateReportFields('', 'spam', 'Description');

      expect(errors).toContain('Event ID is required');
    });

    it('should return error when eventId is not a valid UUID', () => {
      const errors = service.validateReportFields('not-a-uuid', 'spam', 'Description');

      expect(errors).toContain('Event ID must be a valid UUID');
    });

    it('should return error when eventId is a non-string type (number)', () => {
      const errors = service.validateReportFields(12345, 'spam', 'Description');

      expect(errors).toContain('Event ID must be a valid UUID');
    });

    it('should return error when eventId is an object', () => {
      const errors = service.validateReportFields({ id: 'test' }, 'spam', 'Description');

      expect(errors).toContain('Event ID must be a valid UUID');
    });

    it('should return error when eventId is a boolean', () => {
      const errors = service.validateReportFields(true, 'spam', 'Description');

      expect(errors).toContain('Event ID must be a valid UUID');
    });

    it('should return error when eventId is a UUID-like string with wrong version digit', () => {
      // UUID v3 format (version digit is 3, not 4)
      const errors = service.validateReportFields('550e8400-e29b-31d4-a716-446655440000', 'spam', 'Description');

      expect(errors).toContain('Event ID must be a valid UUID');
    });

    it('should return error when eventId is a UUID with wrong variant bits', () => {
      // Valid v4 version digit but variant bits are wrong (starts with 0 instead of 8-b)
      const errors = service.validateReportFields('550e8400-e29b-41d4-0716-446655440000', 'spam', 'Description');

      expect(errors).toContain('Event ID must be a valid UUID');
    });

    it('should accept a valid UUID v4 eventId', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', 'Description');

      const eventIdErrors = errors.filter(e => e.includes('Event ID'));
      expect(eventIdErrors).toHaveLength(0);
    });

    it('should accept an uppercase UUID v4 eventId', () => {
      const errors = service.validateReportFields('A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D', 'spam', 'Description');

      const eventIdErrors = errors.filter(e => e.includes('Event ID'));
      expect(eventIdErrors).toHaveLength(0);
    });

    it('should return error when category is missing', () => {
      const errors = service.validateReportFields(VALID_UUID, undefined, 'Description');

      expect(errors).toContain('Category is required');
    });

    it('should return error when category is empty string', () => {
      const errors = service.validateReportFields(VALID_UUID, '', 'Description');

      expect(errors).toContain('Category is required');
    });

    it('should return error when category is not in the allowlist', () => {
      const errors = service.validateReportFields(VALID_UUID, 'not_a_valid_category', 'Description');

      expect(errors.some(e => e.includes('Invalid category'))).toBe(true);
    });

    it('should accept all valid report categories', () => {
      const validCategories = ['spam', 'inappropriate', 'misleading', 'harassment', 'other'];

      for (const category of validCategories) {
        const errors = service.validateReportFields(VALID_UUID, category, 'Description');
        const categoryErrors = errors.filter(e => e.includes('category') || e.includes('Category'));
        expect(categoryErrors).toHaveLength(0);
      }
    });

    it('should return error when description is missing', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', undefined);

      expect(errors).toContain('Description is required');
    });

    it('should return error when description is empty string', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', '');

      expect(errors).toContain('Description is required');
    });

    it('should return error when description is only whitespace', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', '   ');

      expect(errors).toContain('Description is required');
    });

    it('should return error when description is a number', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', 12345);

      expect(errors).toContain('Description must be a string');
    });

    it('should return error when description is a boolean', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', true);

      expect(errors).toContain('Description must be a string');
    });

    it('should return error when description is an object', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', { text: 'hello' });

      expect(errors).toContain('Description must be a string');
    });

    it('should return error when description is an array', () => {
      const errors = service.validateReportFields(VALID_UUID, 'spam', ['line1', 'line2']);

      expect(errors).toContain('Description must be a string');
    });

    it('should return error when description exceeds 2000 characters', () => {
      const longDescription = 'a'.repeat(2001);
      const errors = service.validateReportFields(VALID_UUID, 'spam', longDescription);

      expect(errors.some(e => e.includes('2000 characters or fewer'))).toBe(true);
    });

    it('should accept a description of exactly 2000 characters', () => {
      const exactDescription = 'a'.repeat(2000);
      const errors = service.validateReportFields(VALID_UUID, 'spam', exactDescription);

      const descErrors = errors.filter(e => e.includes('Description') || e.includes('characters'));
      expect(descErrors).toHaveLength(0);
    });

    it('should collect multiple errors when multiple fields are invalid', () => {
      const errors = service.validateReportFields(undefined, undefined, undefined);

      expect(errors.length).toBeGreaterThanOrEqual(3);
      expect(errors).toContain('Event ID is required');
      expect(errors).toContain('Category is required');
      expect(errors).toContain('Description is required');
    });
  });

  describe('validateEmailField', () => {

    it('should return no errors for a valid email', () => {
      const errors = service.validateEmailField('test@example.com');

      expect(errors).toHaveLength(0);
    });

    it('should return error when email is missing', () => {
      const errors = service.validateEmailField(undefined);

      expect(errors).toContain('Email is required');
    });

    it('should return error when email is empty string', () => {
      const errors = service.validateEmailField('');

      expect(errors).toContain('Email is required');
    });

    it('should return error when email exceeds 254 characters', () => {
      const longEmail = 'a'.repeat(250) + '@test.com';
      const errors = service.validateEmailField(longEmail);

      expect(errors.some(e => e.includes('254 characters or fewer'))).toBe(true);
    });

    it('should return error when email format is invalid', () => {
      const errors = service.validateEmailField('not-an-email');

      expect(errors).toContain('A valid email address is required');
    });

    it('should return error when email is not a string', () => {
      const errors = service.validateEmailField(12345);

      expect(errors).toContain('A valid email address is required');
    });

    it('should accept an email of exactly 254 characters', () => {
      const exactEmail = 'a'.repeat(244) + '@test.com';
      const errors = service.validateEmailField(exactEmail);

      expect(errors).toHaveLength(0);
    });
  });

  describe('validateCreateReportForEventInput', () => {

    it('should not throw for valid authenticated report input', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 'Valid report',
          reporterType: 'authenticated',
          reporterAccountId: 'account-1',
        });
      }).not.toThrow();
    });

    it('should not throw for valid anonymous report input', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 'Valid report',
          reporterEmail: 'test@example.com',
          reporterType: 'anonymous',
        });
      }).not.toThrow();
    });

    it('should throw ReportValidationError for invalid eventId', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: 'not-a-uuid',
          category: ReportCategory.SPAM,
          description: 'Valid report',
          reporterType: 'authenticated',
        });
      }).toThrow(ReportValidationError);
    });

    it('should throw ReportValidationError for invalid category', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: 'invalid' as ReportCategory,
          description: 'Valid report',
          reporterType: 'authenticated',
        });
      }).toThrow(ReportValidationError);
    });

    it('should throw ReportValidationError for empty description', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: '   ',
          reporterType: 'authenticated',
        });
      }).toThrow(ReportValidationError);
    });

    it('should throw ReportValidationError for non-string description (number)', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 123 as any,
          reporterType: 'authenticated',
        });
      }).toThrow(ReportValidationError);
    });

    it('should throw ReportValidationError for missing email on anonymous reports', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 'Valid report',
          reporterType: 'anonymous',
        });
      }).toThrow(ReportValidationError);
    });

    it('should throw ReportValidationError for invalid email on anonymous reports', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 'Valid report',
          reporterEmail: 'not-an-email',
          reporterType: 'anonymous',
        });
      }).toThrow(ReportValidationError);
    });

    it('should not validate email for authenticated reports', () => {
      expect(() => {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 'Valid report',
          reporterType: 'authenticated',
          // No email provided and that is fine for authenticated
        });
      }).not.toThrow();
    });

    it('should collect all errors across all fields in a single exception', () => {
      try {
        service.validateCreateReportForEventInput({
          eventId: 'not-a-uuid',
          category: 'invalid' as ReportCategory,
          description: '',
          reporterEmail: 'bad-email',
          reporterType: 'anonymous',
        });
        // Should not reach here
        expect(true).toBe(false);
      }
      catch (error) {
        expect(error).toBeInstanceOf(ReportValidationError);
        const validationError = error as ReportValidationError;
        expect(validationError.errors.length).toBeGreaterThanOrEqual(4);
        expect(validationError.errors.some(e => e.includes('UUID'))).toBe(true);
        expect(validationError.errors.some(e => e.includes('category'))).toBe(true);
        expect(validationError.errors.some(e => e.includes('Description'))).toBe(true);
        expect(validationError.errors.some(e => e.includes('email'))).toBe(true);
      }
    });

    it('should include email errors along with field errors for anonymous reports', () => {
      try {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 'Valid description',
          reporterEmail: 'a'.repeat(260),
          reporterType: 'anonymous',
        });
        expect(true).toBe(false);
      }
      catch (error) {
        expect(error).toBeInstanceOf(ReportValidationError);
        const validationError = error as ReportValidationError;
        expect(validationError.errors.some(e => e.includes('254 characters'))).toBe(true);
      }
    });

    it('should include "must be a string" error when non-string description is provided', () => {
      try {
        service.validateCreateReportForEventInput({
          eventId: VALID_UUID,
          category: ReportCategory.SPAM,
          description: 42 as any,
          reporterType: 'authenticated',
        });
        expect(true).toBe(false);
      }
      catch (error) {
        expect(error).toBeInstanceOf(ReportValidationError);
        const validationError = error as ReportValidationError;
        expect(validationError.errors).toContain('Description must be a string');
      }
    });
  });

  describe('createReport', () => {

    it('should create a report for an anonymous reporter with hashed email and verification token', async () => {
      const hasReporterStub = sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);

      // Stub the entity save to return a model-like entity
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.calendarId = 'calendar-1';
      report.category = ReportCategory.SPAM;
      report.description = 'This is spam';
      report.reporterType = 'anonymous';
      report.status = ReportStatus.PENDING_VERIFICATION;

      const mockEntity = {
        save: sandbox.stub().resolves({
          toModel: () => report,
        }),
      };
      sandbox.stub(ReportEntity, 'fromModel').returns(mockEntity as any);

      const mockReporterEntity = {
        save: sandbox.stub().resolves({}),
      };
      sandbox.stub(EventReporterEntity, 'fromModel').returns(mockReporterEntity as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      const result = await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'This is spam',
        reporterEmail: 'test@example.com',
        reporterType: 'anonymous',
      });

      expect(result).toBeDefined();
      expect(result.eventId).toBe('event-1');
      expect(hasReporterStub.calledOnce).toBe(true);
      expect(mockEntity.save.calledOnce).toBe(true);
      expect(mockReporterEntity.save.calledOnce).toBe(true);
      expect(emitSpy.calledWith('reportCreated')).toBe(true);
    });

    it('should set verification token and expiration for anonymous reporters', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Spam event',
        reporterEmail: 'test@example.com',
        reporterType: 'anonymous',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.verificationToken).toBeTruthy();
      expect(capturedReport!.verificationToken!.length).toBe(64); // 32 bytes hex
      expect(capturedReport!.verificationExpiration).toBeInstanceOf(Date);
      expect(capturedReport!.verificationExpiration!.getTime()).toBeGreaterThan(Date.now());
      expect(capturedReport!.status).toBe(ReportStatus.PENDING_VERIFICATION);
    });

    it('should hash the email for anonymous reporters', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.INAPPROPRIATE,
        description: 'Bad content',
        reporterEmail: 'Test@Example.com',
        reporterType: 'anonymous',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.reporterEmailHash).toBeTruthy();
      // Email should be lowercased before hashing
      expect(capturedReport!.reporterEmailHash!.length).toBe(64); // SHA-256 hex
    });

    it('should set status to submitted for authenticated reporters', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.HARASSMENT,
        description: 'Harassing content',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.status).toBe(ReportStatus.SUBMITTED);
      expect(capturedReport!.reporterAccountId).toBe('account-1');
      expect(capturedReport!.verificationToken).toBeNull();
    });

    it('should set admin fields for administrator reporters', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      let capturedReport: Report | null = null;
      sandbox.stub(ReportEntity, 'fromModel').callsFake((r: Report) => {
        capturedReport = r;
        return {
          save: sandbox.stub().resolves({ toModel: () => r }),
        } as any;
      });
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      const deadline = new Date('2026-03-01');

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.MISLEADING,
        description: 'Misleading event info',
        reporterAccountId: 'admin-account-1',
        reporterType: 'administrator',
        adminId: 'admin-account-1',
        adminPriority: 'high',
        adminDeadline: deadline,
        adminNotes: 'Urgent review needed',
      });

      expect(capturedReport).not.toBeNull();
      expect(capturedReport!.status).toBe(ReportStatus.SUBMITTED);
      expect(capturedReport!.adminId).toBe('admin-account-1');
      expect(capturedReport!.adminPriority).toBe('high');
      expect(capturedReport!.adminDeadline).toEqual(deadline);
      expect(capturedReport!.adminNotes).toBe('Urgent review needed');
    });

    it('should throw DuplicateReportError if reporter already reported the event', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(true);
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(false);

      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Spam again',
        reporterEmail: 'test@example.com',
        reporterType: 'anonymous',
      })).rejects.toThrow(DuplicateReportError);
    });

    it('should throw an error if anonymous report is missing email', async () => {
      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Missing email',
        reporterType: 'anonymous',
      })).rejects.toThrow('Reporter email is required for anonymous reports');
    });

    it('should throw EmailRateLimitError when email exceeds rate limit', async () => {
      sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(true);

      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Too many reports',
        reporterEmail: 'spammer@example.com',
        reporterType: 'anonymous',
      })).rejects.toThrow(EmailRateLimitError);
    });

    it('should check email rate limit before duplicate check for anonymous reporters', async () => {
      const emailRateLimitStub = sandbox.stub(service, 'hasExceededEmailRateLimit').resolves(true);
      const duplicateStub = sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Rate limited',
        reporterEmail: 'limited@example.com',
        reporterType: 'anonymous',
      })).rejects.toThrow(EmailRateLimitError);

      // Email rate limit should be checked
      expect(emailRateLimitStub.calledOnce).toBe(true);
      // Duplicate check should NOT be reached since rate limit was hit first
      expect(duplicateStub.called).toBe(false);
    });

    it('should not check email rate limit for authenticated reporters', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);
      const emailRateLimitStub = sandbox.stub(service, 'hasExceededEmailRateLimit');

      const report = new Report('report-id-1');
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Auth report',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      });

      expect(emailRateLimitStub.called).toBe(false);
    });

    it('should create EventReporter record for duplicate tracking', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);

      let capturedReporterData: any = null;
      sandbox.stub(EventReporterEntity, 'fromModel').callsFake((data: any) => {
        capturedReporterData = data;
        return { save: sandbox.stub().resolves({}) } as any;
      });

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Test',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      });

      expect(capturedReporterData).not.toBeNull();
      expect(capturedReporterData.eventId).toBe('event-1');
      expect(capturedReporterData.reporterIdentifier).toBe('account-1');
      expect(capturedReporterData.reportId).toBe('report-id-1');
    });

    it('should throw DuplicateReportError and clean up orphaned report on concurrent duplicate insert', async () => {
      // Simulate the race condition: hasReporterAlreadyReported passes (returns false)
      // but a concurrent request inserts the EventReporter first, so our save
      // hits the DB unique constraint
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-orphan');
      report.eventId = 'event-1';
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);

      const destroyStub = sandbox.stub(ReportEntity, 'destroy').resolves(1);

      // EventReporterEntity.save() throws UniqueConstraintError to simulate
      // the concurrent insert that won the race
      const uniqueError = new UniqueConstraintError({});
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().rejects(uniqueError),
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Concurrent duplicate',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      })).rejects.toThrow(DuplicateReportError);

      // The orphaned ReportEntity should be cleaned up
      expect(destroyStub.calledOnce).toBe(true);
      expect(destroyStub.firstCall.args[0]).toEqual({ where: { id: 'report-id-orphan' } });

      // No domain event should be emitted for a failed creation
      expect(emitSpy.calledWith('reportCreated')).toBe(false);
    });

    it('should re-throw non-UniqueConstraintError errors from EventReporterEntity.save()', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-1');
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);

      // Simulate a generic database error (not a unique constraint violation)
      const genericError = new Error('Connection lost');
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().rejects(genericError),
      } as any);

      await expect(service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.SPAM,
        description: 'Test',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      })).rejects.toThrow('Connection lost');
    });
  });

  describe('hasExceededEmailRateLimit', () => {

    it('should return true when report count equals the max limit', async () => {
      const countStub = sandbox.stub(ReportEntity, 'count').resolves(3);

      const result = await service.hasExceededEmailRateLimit('some-email-hash');

      expect(result).toBe(true);
      expect(countStub.calledOnce).toBe(true);
    });

    it('should return true when report count exceeds the max limit', async () => {
      sandbox.stub(ReportEntity, 'count').resolves(5);

      const result = await service.hasExceededEmailRateLimit('some-email-hash');

      expect(result).toBe(true);
    });

    it('should return false when report count is below the max limit', async () => {
      sandbox.stub(ReportEntity, 'count').resolves(1);

      const result = await service.hasExceededEmailRateLimit('some-email-hash');

      expect(result).toBe(false);
    });

    it('should return false when no recent reports exist', async () => {
      sandbox.stub(ReportEntity, 'count').resolves(0);

      const result = await service.hasExceededEmailRateLimit('some-email-hash');

      expect(result).toBe(false);
    });

    it('should query with correct email hash and time window', async () => {
      const countStub = sandbox.stub(ReportEntity, 'count').resolves(0);

      await service.hasExceededEmailRateLimit('test-hash-123');

      expect(countStub.calledOnce).toBe(true);
      const callArgs = countStub.firstCall.args[0] as any;
      expect(callArgs.where.reporter_email_hash).toBe('test-hash-123');
      // The created_at filter should use Op.gte with a date within the window
      expect(callArgs.where.created_at).toBeDefined();
    });
  });

  describe('getReportById', () => {

    it('should return a report when found', async () => {
      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      report.status = ReportStatus.SUBMITTED;

      const findByPkStub = sandbox.stub(ReportEntity, 'findByPk');
      findByPkStub.resolves({
        toModel: () => report,
      } as any);

      const result = await service.getReportById('report-id-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('report-id-1');
      expect(result!.eventId).toBe('event-1');
      expect(findByPkStub.calledWith('report-id-1')).toBe(true);
    });

    it('should return null when report not found', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves(null);

      const result = await service.getReportById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getReportsForCalendar', () => {

    it('should return paginated reports for a calendar', async () => {
      const report1 = new Report('r-1');
      report1.calendarId = 'calendar-1';
      const report2 = new Report('r-2');
      report2.calendarId = 'calendar-1';

      const findAndCountAllStub = sandbox.stub(ReportEntity, 'findAndCountAll');
      findAndCountAllStub.resolves({
        rows: [
          { toModel: () => report1 } as any,
          { toModel: () => report2 } as any,
        ],
        count: 2,
      });

      const result = await service.getReportsForCalendar('calendar-1');

      expect(result.reports).toHaveLength(2);
      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.totalCount).toBe(2);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should apply status filter when provided', async () => {
      const findAndCountAllStub = sandbox.stub(ReportEntity, 'findAndCountAll');
      findAndCountAllStub.resolves({ rows: [], count: 0 });

      await service.getReportsForCalendar('calendar-1', { status: ReportStatus.SUBMITTED });

      const callArgs = findAndCountAllStub.firstCall.args[0];
      expect(callArgs.where.status).toBe(ReportStatus.SUBMITTED);
    });

    it('should apply category filter when provided', async () => {
      const findAndCountAllStub = sandbox.stub(ReportEntity, 'findAndCountAll');
      findAndCountAllStub.resolves({ rows: [], count: 0 });

      await service.getReportsForCalendar('calendar-1', { category: ReportCategory.SPAM });

      const callArgs = findAndCountAllStub.firstCall.args[0];
      expect(callArgs.where.category).toBe(ReportCategory.SPAM);
    });

    it('should paginate with custom page and limit', async () => {
      const findAndCountAllStub = sandbox.stub(ReportEntity, 'findAndCountAll');
      findAndCountAllStub.resolves({ rows: [], count: 50 });

      const result = await service.getReportsForCalendar('calendar-1', { page: 3, limit: 10 });

      const callArgs = findAndCountAllStub.firstCall.args[0];
      expect(callArgs.offset).toBe(20); // (3 - 1) * 10
      expect(callArgs.limit).toBe(10);
      expect(result.pagination.currentPage).toBe(3);
      expect(result.pagination.totalPages).toBe(5);
      expect(result.pagination.totalCount).toBe(50);
      expect(result.pagination.limit).toBe(10);
    });
  });

  describe('getReportsForEvent', () => {

    it('should return all reports for an event', async () => {
      const report1 = new Report('r-1');
      report1.eventId = 'event-1';
      const report2 = new Report('r-2');
      report2.eventId = 'event-1';

      const findAllStub = sandbox.stub(ReportEntity, 'findAll');
      findAllStub.resolves([
        { toModel: () => report1 } as any,
        { toModel: () => report2 } as any,
      ]);

      const result = await service.getReportsForEvent('event-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('r-1');
      expect(result[1].id).toBe('r-2');
      expect(findAllStub.calledOnce).toBe(true);
      const callArgs = findAllStub.firstCall.args[0];
      expect(callArgs.where.event_id).toBe('event-1');
    });

    it('should return empty array when no reports exist', async () => {
      sandbox.stub(ReportEntity, 'findAll').resolves([]);

      const result = await service.getReportsForEvent('event-no-reports');

      expect(result).toHaveLength(0);
    });
  });

  describe('getEscalatedReports', () => {

    it('should return only escalated reports', async () => {
      const report = new Report('r-1');
      report.status = ReportStatus.ESCALATED;

      const findAndCountAllStub = sandbox.stub(ReportEntity, 'findAndCountAll');
      findAndCountAllStub.resolves({
        rows: [{ toModel: () => report } as any],
        count: 1,
      });

      const result = await service.getEscalatedReports();

      expect(result.reports).toHaveLength(1);
      expect(result.reports[0].status).toBe(ReportStatus.ESCALATED);
      const callArgs = findAndCountAllStub.firstCall.args[0];
      expect(callArgs.where.status).toBe(ReportStatus.ESCALATED);
    });

    it('should apply category filter to escalated reports', async () => {
      const findAndCountAllStub = sandbox.stub(ReportEntity, 'findAndCountAll');
      findAndCountAllStub.resolves({ rows: [], count: 0 });

      await service.getEscalatedReports({ category: ReportCategory.HARASSMENT });

      const callArgs = findAndCountAllStub.firstCall.args[0];
      expect(callArgs.where.status).toBe(ReportStatus.ESCALATED);
      expect(callArgs.where.category).toBe(ReportCategory.HARASSMENT);
    });

    it('should support pagination for escalated reports', async () => {
      const findAndCountAllStub = sandbox.stub(ReportEntity, 'findAndCountAll');
      findAndCountAllStub.resolves({ rows: [], count: 30 });

      const result = await service.getEscalatedReports({ page: 2, limit: 10 });

      const callArgs = findAndCountAllStub.firstCall.args[0];
      expect(callArgs.offset).toBe(10);
      expect(callArgs.limit).toBe(10);
      expect(result.pagination.currentPage).toBe(2);
      expect(result.pagination.totalPages).toBe(3);
    });
  });

  describe('verifyReport', () => {

    it('should verify a report with a valid token using an atomic update', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.SUBMITTED;

      // Stub ReportEntity.update (static) to simulate 1 row affected
      const updateStub = sandbox.stub(ReportEntity, 'update').resolves([1]);

      // Stub ReportEntity.findOne to return the updated entity
      sandbox.stub(ReportEntity, 'findOne').resolves({
        toModel: () => report,
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      const result = await service.verifyReport('valid-token');

      expect(result).toBeDefined();
      expect(result.status).toBe(ReportStatus.SUBMITTED);

      // Verify the atomic update was called with correct parameters
      expect(updateStub.calledOnce).toBe(true);
      const [updateValues, updateOptions] = updateStub.firstCall.args;
      expect(updateValues.status).toBe(ReportStatus.SUBMITTED);
      expect(updateValues.verification_token).toBeNull();
      expect(updateValues.verification_expiration).toBeNull();
      expect(updateOptions.where.verification_token).toBe('valid-token');
      expect(updateOptions.where.status).toBe(ReportStatus.PENDING_VERIFICATION);
      expect(updateOptions.where.verification_expiration).toBeDefined();

      expect(emitSpy.calledWith('reportVerified')).toBe(true);
    });

    it('should throw InvalidVerificationTokenError when no rows are affected (invalid token)', async () => {
      // Atomic update returns 0 affected rows - token not found or already used
      sandbox.stub(ReportEntity, 'update').resolves([0]);

      await expect(service.verifyReport('invalid-token'))
        .rejects.toThrow(InvalidVerificationTokenError);
    });

    it('should throw InvalidVerificationTokenError when token is expired (0 rows affected)', async () => {
      // An expired token will not match the WHERE clause (verification_expiration > NOW()),
      // so the atomic update returns 0 affected rows
      sandbox.stub(ReportEntity, 'update').resolves([0]);

      await expect(service.verifyReport('expired-token'))
        .rejects.toThrow(InvalidVerificationTokenError);
    });

    it('should throw InvalidVerificationTokenError when token was already consumed by another request', async () => {
      // Race condition scenario: another request already consumed the token,
      // so the atomic update returns 0 affected rows
      sandbox.stub(ReportEntity, 'update').resolves([0]);

      await expect(service.verifyReport('already-consumed-token'))
        .rejects.toThrow(InvalidVerificationTokenError);
    });

    it('should include expiration check in the atomic update WHERE clause', async () => {
      const updateStub = sandbox.stub(ReportEntity, 'update').resolves([1]);

      const report = new Report('report-id-1');
      report.status = ReportStatus.SUBMITTED;
      sandbox.stub(ReportEntity, 'findOne').resolves({
        toModel: () => report,
      } as any);

      await service.verifyReport('some-token');

      const updateOptions = updateStub.firstCall.args[1];
      // The WHERE clause should include verification_expiration with Op.gt
      expect(updateOptions.where.verification_expiration).toBeDefined();
    });
  });

  describe('resolveReport', () => {

    it('should resolve a submitted report', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.RESOLVED;

      const mockEntity = {
        status: ReportStatus.SUBMITTED,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      };

      sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

      const mockEscalationEntity = {
        save: sandbox.stub().resolves({}),
      };
      sandbox.stub(ReportEscalationEntity, 'fromModel').returns(mockEscalationEntity as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      const result = await service.resolveReport('report-id-1', 'reviewer-1', 'Looks fine');

      expect(result).toBeDefined();
      expect(mockEntity.update.calledOnce).toBe(true);
      const updateArgs = mockEntity.update.firstCall.args[0];
      expect(updateArgs.status).toBe(ReportStatus.RESOLVED);
      expect(updateArgs.reviewer_id).toBe('reviewer-1');
      expect(updateArgs.reviewer_notes).toBe('Looks fine');
      expect(updateArgs.reviewer_timestamp).toBeInstanceOf(Date);
      expect(mockEscalationEntity.save.calledOnce).toBe(true);
      expect(emitSpy.calledWith('reportResolved')).toBe(true);
    });

    it('should create an escalation record with correct data', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.RESOLVED;

      const mockEntity = {
        status: ReportStatus.SUBMITTED,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      };

      sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

      let capturedEscalationData: any = null;
      sandbox.stub(ReportEscalationEntity, 'fromModel').callsFake((data: any) => {
        capturedEscalationData = data;
        return { save: sandbox.stub().resolves({}) } as any;
      });

      await service.resolveReport('report-id-1', 'reviewer-1', 'Resolved');

      expect(capturedEscalationData).not.toBeNull();
      expect(capturedEscalationData.reportId).toBe('report-id-1');
      expect(capturedEscalationData.fromStatus).toBe(ReportStatus.SUBMITTED);
      expect(capturedEscalationData.toStatus).toBe(ReportStatus.RESOLVED);
      expect(capturedEscalationData.reviewerId).toBe('reviewer-1');
      expect(capturedEscalationData.reviewerRole).toBe('owner');
      expect(capturedEscalationData.decision).toBe('resolved');
      expect(capturedEscalationData.notes).toBe('Resolved');
    });

    it('should throw ReportNotFoundError if report does not exist', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves(null);

      await expect(service.resolveReport('nonexistent', 'reviewer-1', 'notes'))
        .rejects.toThrow(ReportNotFoundError);
    });

    it('should throw ReportAlreadyResolvedError if report is already resolved', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.RESOLVED,
      } as any);

      await expect(service.resolveReport('report-1', 'reviewer-1', 'notes'))
        .rejects.toThrow(ReportAlreadyResolvedError);
    });

    it('should throw ReportAlreadyResolvedError if report is already dismissed', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.DISMISSED,
      } as any);

      await expect(service.resolveReport('report-1', 'reviewer-1', 'notes'))
        .rejects.toThrow(ReportAlreadyResolvedError);
    });
  });

  describe('dismissReport', () => {

    it('should auto-escalate a dismissed report to escalated status', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.ESCALATED;

      const mockEntity = {
        status: ReportStatus.SUBMITTED,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      };

      sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

      const mockEscalationEntity = {
        save: sandbox.stub().resolves({}),
      };
      sandbox.stub(ReportEscalationEntity, 'fromModel').returns(mockEscalationEntity as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      const result = await service.dismissReport('report-id-1', 'owner-1', 'Not an issue');

      expect(result).toBeDefined();
      expect(mockEntity.update.calledOnce).toBe(true);
      const updateArgs = mockEntity.update.firstCall.args[0];
      expect(updateArgs.status).toBe(ReportStatus.ESCALATED);
      expect(updateArgs.escalation_type).toBe('automatic');
      expect(updateArgs.reviewer_id).toBe('owner-1');
      expect(updateArgs.reviewer_notes).toBe('Not an issue');
      expect(emitSpy.calledWith('reportEscalated')).toBe(true);
    });

    it('should create escalation record with automatic escalation type', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.ESCALATED;

      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.SUBMITTED,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      } as any);

      let capturedEscalationData: any = null;
      sandbox.stub(ReportEscalationEntity, 'fromModel').callsFake((data: any) => {
        capturedEscalationData = data;
        return { save: sandbox.stub().resolves({}) } as any;
      });

      await service.dismissReport('report-id-1', 'owner-1', 'Dismissed');

      expect(capturedEscalationData).not.toBeNull();
      expect(capturedEscalationData.fromStatus).toBe(ReportStatus.SUBMITTED);
      expect(capturedEscalationData.toStatus).toBe(ReportStatus.ESCALATED);
      expect(capturedEscalationData.decision).toBe('dismissed');
      expect(capturedEscalationData.reviewerRole).toBe('owner');
    });

    it('should throw ReportNotFoundError if report does not exist', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves(null);

      await expect(service.dismissReport('nonexistent', 'owner-1', 'notes'))
        .rejects.toThrow(ReportNotFoundError);
    });

    it('should throw ReportAlreadyResolvedError if report is already resolved', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.RESOLVED,
      } as any);

      await expect(service.dismissReport('report-1', 'owner-1', 'notes'))
        .rejects.toThrow(ReportAlreadyResolvedError);
    });

    it('should throw ReportAlreadyResolvedError if report is already dismissed', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.DISMISSED,
      } as any);

      await expect(service.dismissReport('report-1', 'owner-1', 'notes'))
        .rejects.toThrow(ReportAlreadyResolvedError);
    });
  });

  describe('escalateReport', () => {

    it('should manually escalate a report', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.ESCALATED;

      const mockEntity = {
        status: ReportStatus.SUBMITTED,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      };

      sandbox.stub(ReportEntity, 'findByPk').resolves(mockEntity as any);

      const mockEscalationEntity = {
        save: sandbox.stub().resolves({}),
      };
      sandbox.stub(ReportEscalationEntity, 'fromModel').returns(mockEscalationEntity as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      const result = await service.escalateReport('report-id-1', 'Needs admin review');

      expect(result).toBeDefined();
      expect(mockEntity.update.calledOnce).toBe(true);
      const updateArgs = mockEntity.update.firstCall.args[0];
      expect(updateArgs.status).toBe(ReportStatus.ESCALATED);
      expect(updateArgs.escalation_type).toBe('manual');
      expect(mockEscalationEntity.save.calledOnce).toBe(true);
      expect(emitSpy.calledWith('reportEscalated')).toBe(true);
    });

    it('should create escalation record with manual escalation type and system role', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.ESCALATED;

      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.UNDER_REVIEW,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      } as any);

      let capturedEscalationData: any = null;
      sandbox.stub(ReportEscalationEntity, 'fromModel').callsFake((data: any) => {
        capturedEscalationData = data;
        return { save: sandbox.stub().resolves({}) } as any;
      });

      await service.escalateReport('report-id-1', 'Complex case');

      expect(capturedEscalationData).not.toBeNull();
      expect(capturedEscalationData.fromStatus).toBe(ReportStatus.UNDER_REVIEW);
      expect(capturedEscalationData.toStatus).toBe(ReportStatus.ESCALATED);
      expect(capturedEscalationData.decision).toBe('escalated');
      expect(capturedEscalationData.reviewerRole).toBe('system');
      expect(capturedEscalationData.notes).toBe('Complex case');
    });

    it('should throw ReportNotFoundError if report does not exist', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves(null);

      await expect(service.escalateReport('nonexistent', 'reason'))
        .rejects.toThrow(ReportNotFoundError);
    });

    it('should throw ReportAlreadyResolvedError if report is already resolved', async () => {
      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.RESOLVED,
      } as any);

      await expect(service.escalateReport('report-1', 'reason'))
        .rejects.toThrow(ReportAlreadyResolvedError);
    });
  });

  describe('hasReporterAlreadyReported', () => {

    it('should return true if a matching EventReporter record exists', async () => {
      sandbox.stub(EventReporterEntity, 'findOne').resolves({
        id: 'er-1',
        event_id: 'event-1',
        reporter_identifier: 'some-hash',
      } as any);

      const result = await service.hasReporterAlreadyReported('event-1', 'some-hash');

      expect(result).toBe(true);
    });

    it('should return false if no matching EventReporter record exists', async () => {
      sandbox.stub(EventReporterEntity, 'findOne').resolves(null);

      const result = await service.hasReporterAlreadyReported('event-1', 'new-hash');

      expect(result).toBe(false);
    });

    it('should query with correct event_id and reporter_identifier', async () => {
      const findOneStub = sandbox.stub(EventReporterEntity, 'findOne').resolves(null);

      await service.hasReporterAlreadyReported('event-42', 'reporter-abc');

      expect(findOneStub.calledOnce).toBe(true);
      const callArgs = findOneStub.firstCall.args[0];
      expect(callArgs.where.event_id).toBe('event-42');
      expect(callArgs.where.reporter_identifier).toBe('reporter-abc');
    });
  });

  describe('event emission', () => {

    it('should not throw if eventBus is not provided', async () => {
      const serviceNoEventBus = new ModerationService();

      sandbox.stub(serviceNoEventBus, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-1');
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      await expect(serviceNoEventBus.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.OTHER,
        description: 'Test',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      })).resolves.toBeDefined();
    });

    it('should emit reportCreated event with report payload', async () => {
      sandbox.stub(service, 'hasReporterAlreadyReported').resolves(false);

      const report = new Report('report-id-1');
      report.eventId = 'event-1';
      sandbox.stub(ReportEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({ toModel: () => report }),
      } as any);
      sandbox.stub(EventReporterEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.createReport({
        eventId: 'event-1',
        calendarId: 'calendar-1',
        category: ReportCategory.OTHER,
        description: 'Test',
        reporterAccountId: 'account-1',
        reporterType: 'authenticated',
      });

      expect(emitSpy.calledWith('reportCreated', sinon.match({ report }))).toBe(true);
    });

    it('should emit reportResolved event with report and reviewerId', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.RESOLVED;

      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.SUBMITTED,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      } as any);
      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.resolveReport('report-id-1', 'reviewer-1', 'Done');

      expect(emitSpy.calledWith('reportResolved', sinon.match({
        report,
        reviewerId: 'reviewer-1',
      }))).toBe(true);
    });

    it('should emit reportEscalated event on dismiss (auto-escalation)', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.ESCALATED;

      sandbox.stub(ReportEntity, 'findByPk').resolves({
        status: ReportStatus.SUBMITTED,
        update: sandbox.stub().resolves(),
        toModel: () => report,
      } as any);
      sandbox.stub(ReportEscalationEntity, 'fromModel').returns({
        save: sandbox.stub().resolves({}),
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.dismissReport('report-id-1', 'owner-1', 'Not a real issue');

      expect(emitSpy.calledWith('reportEscalated', sinon.match({
        report,
        reason: 'Not a real issue',
      }))).toBe(true);
    });

    it('should emit reportVerified event on successful verification', async () => {
      const report = new Report('report-id-1');
      report.status = ReportStatus.SUBMITTED;

      // Stub atomic update to succeed
      sandbox.stub(ReportEntity, 'update').resolves([1]);

      // Stub findOne to return the updated entity
      sandbox.stub(ReportEntity, 'findOne').resolves({
        toModel: () => report,
      } as any);

      const emitSpy = sandbox.spy(eventBus, 'emit');

      await service.verifyReport('valid-token');

      expect(emitSpy.calledWith('reportVerified', sinon.match({ report }))).toBe(true);
    });

    describe('forwardReport', () => {
      let service: ModerationService;
      let sandbox: sinon.SinonSandbox;
      let mockEventBus: EventEmitter;
      let mockCalendarInterface: CalendarInterface;
      let mockConfigInterface: ConfigurationInterface;
      let mockActivityPubInterface: ActivityPubInterface;

      beforeEach(() => {
        sandbox = sinon.createSandbox();
        mockEventBus = new EventEmitter();
        mockCalendarInterface = new CalendarInterface(mockEventBus);
        mockConfigInterface = new ConfigurationInterface(mockEventBus);
        mockActivityPubInterface = {} as ActivityPubInterface;

        service = new ModerationService(
          mockEventBus,
          mockCalendarInterface,
          mockConfigInterface,
          mockActivityPubInterface,
        );
      });

      afterEach(() => {
        sandbox.restore();
      });

      it('should throw error if ActivityPubInterface is not provided', async () => {
        const serviceWithoutAP = new ModerationService(mockEventBus, mockCalendarInterface, mockConfigInterface);
        await expect(serviceWithoutAP.forwardReport('report-id', 'remote-actor')).rejects.toThrow(
          'ActivityPubInterface is required for forwardReport',
        );
      });

      it('should throw ReportNotFoundError if report does not exist', async () => {
        sandbox.stub(service, 'getReportById').resolves(null);

        await expect(service.forwardReport('nonexistent-report', 'remote-actor')).rejects.toThrow(
          ReportNotFoundError,
        );
      });

      it('should throw EventNotFoundError if event does not exist', async () => {
        const mockReport = Report.fromObject({
          id: 'report-id',
          eventId: 'event-id',
          calendarId: 'calendar-id',
          category: ReportCategory.SPAM,
          description: 'Test report',
          reporterType: 'authenticated',
          status: ReportStatus.SUBMITTED,
        });

        sandbox.stub(service, 'getReportById').resolves(mockReport);
        sandbox.stub(mockCalendarInterface, 'getEventById').rejects(new EventNotFoundError());

        await expect(service.forwardReport('report-id', 'remote-actor')).rejects.toThrow(
          EventNotFoundError,
        );
      });

      it('should send Flag activity via ActivityPub outbox', async () => {
        const mockReport = Report.fromObject({
          id: 'report-id',
          eventId: 'event-id',
          calendarId: 'calendar-id',
          category: ReportCategory.SPAM,
          description: 'Test report description',
          reporterType: 'authenticated',
          status: ReportStatus.SUBMITTED,
          createdAt: new Date('2026-02-10T12:00:00Z'),
        });

        const mockEvent = CalendarEvent.fromObject({
          id: 'event-id',
          calendarId: 'calendar-id',
          name: 'Test Event',
        });

        const mockCalendar = Calendar.fromObject({
          id: 'calendar-id',
          urlName: 'test-calendar',
        });

        sandbox.stub(service, 'getReportById').resolves(mockReport);
        sandbox.stub(mockCalendarInterface, 'getEventById').resolves(mockEvent);
        sandbox.stub(mockCalendarInterface, 'getCalendar').resolves(mockCalendar);

        const actorUrlStub = sandbox.stub().resolves('https://local.instance/calendars/test-calendar');
        const addToOutboxStub = sandbox.stub().resolves();
        mockActivityPubInterface.actorUrl = actorUrlStub;
        mockActivityPubInterface.addToOutbox = addToOutboxStub;

        const configStub = sandbox.stub(config, 'get');
        configStub.withArgs('server.domain').returns('local.instance');

        const eventEmitSpy = sandbox.spy(mockEventBus, 'emit');

        await service.forwardReport('report-id', 'https://remote.instance/calendars/remote');

        // Verify Flag activity was built and sent
        expect(addToOutboxStub.calledOnce).toBe(true);
        const flagActivity = addToOutboxStub.getCall(0).args[1];
        expect(flagActivity.type).toBe('Flag');
        expect(flagActivity.content).toBe('Test report description');
        expect(flagActivity.to).toEqual(['https://remote.instance/calendars/remote']);

        // Verify event was emitted
        expect(eventEmitSpy.calledWith('reportForwarded')).toBe(true);
      });

      it('should build admin Flag activity for administrator reports', async () => {
        const mockReport = Report.fromObject({
          id: 'report-id',
          eventId: 'event-id',
          calendarId: 'calendar-id',
          category: ReportCategory.INAPPROPRIATE_CONTENT,
          description: 'Admin concern',
          reporterType: 'administrator',
          status: ReportStatus.SUBMITTED,
          adminId: 'admin-id',
          adminPriority: 'high',
          createdAt: new Date('2026-02-10T12:00:00Z'),
        });

        const mockEvent = CalendarEvent.fromObject({
          id: 'event-id',
          calendarId: 'calendar-id',
          name: 'Test Event',
        });

        const mockCalendar = Calendar.fromObject({
          id: 'calendar-id',
          urlName: 'test-calendar',
        });

        sandbox.stub(service, 'getReportById').resolves(mockReport);
        sandbox.stub(mockCalendarInterface, 'getEventById').resolves(mockEvent);
        sandbox.stub(mockCalendarInterface, 'getCalendar').resolves(mockCalendar);

        const addToOutboxStub = sandbox.stub().resolves();
        mockActivityPubInterface.actorUrl = sandbox.stub().resolves('https://local.instance/calendars/test');
        mockActivityPubInterface.addToOutbox = addToOutboxStub;

        const configStub = sandbox.stub(config, 'get');
        configStub.withArgs('server.domain').returns('local.instance');

        await service.forwardReport('report-id', 'https://remote.instance/admin');

        // Verify admin Flag activity was built
        expect(addToOutboxStub.calledOnce).toBe(true);
        const flagActivity = addToOutboxStub.getCall(0).args[1];
        expect(flagActivity.type).toBe('Flag');
        expect(flagActivity.tag).toBeDefined();
        expect(flagActivity.tag.some((t: any) => t.name === '#admin-flag')).toBe(true);
        expect(flagActivity.tag.some((t: any) => t.name === '#priority-high')).toBe(true);
      });
    });
  });
});
