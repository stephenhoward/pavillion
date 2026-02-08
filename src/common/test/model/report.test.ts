import { describe, it, expect } from 'vitest';
import { Report, ReportCategory, ReportStatus } from '@/common/model/report';

describe('ReportCategory enum', () => {

  it('should define all expected category values', () => {
    expect(ReportCategory.SPAM).toBe('spam');
    expect(ReportCategory.INAPPROPRIATE).toBe('inappropriate');
    expect(ReportCategory.MISLEADING).toBe('misleading');
    expect(ReportCategory.HARASSMENT).toBe('harassment');
    expect(ReportCategory.OTHER).toBe('other');
  });

  it('should have exactly 5 categories', () => {
    const values = Object.values(ReportCategory);
    expect(values).toHaveLength(5);
  });
});

describe('ReportStatus enum', () => {

  it('should define all expected status values', () => {
    expect(ReportStatus.PENDING_VERIFICATION).toBe('pending_verification');
    expect(ReportStatus.SUBMITTED).toBe('submitted');
    expect(ReportStatus.UNDER_REVIEW).toBe('under_review');
    expect(ReportStatus.RESOLVED).toBe('resolved');
    expect(ReportStatus.DISMISSED).toBe('dismissed');
    expect(ReportStatus.ESCALATED).toBe('escalated');
  });

  it('should have exactly 6 statuses', () => {
    const values = Object.values(ReportStatus);
    expect(values).toHaveLength(6);
  });
});

describe('Report Model', () => {

  const sampleDate = new Date('2026-02-07T10:00:00Z');
  const sampleDate2 = new Date('2026-02-08T12:00:00Z');

  function createFullReport(): Report {
    const report = new Report('report-id-1');
    report.eventId = 'event-id-1';
    report.calendarId = 'calendar-id-1';
    report.category = ReportCategory.SPAM;
    report.description = 'This event is spam';
    report.reporterEmailHash = 'abc123hash';
    report.reporterAccountId = null;
    report.reporterType = 'anonymous';
    report.adminId = null;
    report.adminPriority = null;
    report.adminDeadline = null;
    report.adminNotes = null;
    report.status = ReportStatus.SUBMITTED;
    report.ownerNotes = null;
    report.reviewerId = null;
    report.reviewerNotes = null;
    report.reviewerTimestamp = null;
    report.verificationToken = null;
    report.verificationExpiration = null;
    report.escalationType = null;
    report.createdAt = sampleDate;
    report.updatedAt = sampleDate;
    return report;
  }

  /**
   * Creates a report with all sensitive fields populated,
   * useful for verifying that tiered serialization excludes them.
   */
  function createFullyPopulatedReport(): Report {
    const report = createFullReport();
    report.reporterAccountId = 'account-id-1';
    report.reporterEmailHash = 'hash-abc123';
    report.verificationToken = 'secret-token-xyz';
    report.verificationExpiration = sampleDate2;
    report.adminId = 'admin-id-1';
    report.adminPriority = 'high';
    report.adminDeadline = sampleDate2;
    report.adminNotes = 'Needs urgent review';
    report.ownerNotes = 'Owner reviewed this';
    report.reviewerId = 'reviewer-id-1';
    report.reviewerNotes = 'Confirmed issue';
    report.reviewerTimestamp = sampleDate2;
    report.escalationType = 'manual';
    report.reporterType = 'authenticated';
    report.status = ReportStatus.UNDER_REVIEW;
    report.updatedAt = sampleDate2;
    return report;
  }

  it('should create instance with default properties', () => {
    const report = new Report();

    expect(report.id).toBe('');
    expect(report.eventId).toBe('');
    expect(report.calendarId).toBe('');
    expect(report.category).toBe(ReportCategory.OTHER);
    expect(report.description).toBe('');
    expect(report.reporterEmailHash).toBe(null);
    expect(report.reporterAccountId).toBe(null);
    expect(report.reporterType).toBe('anonymous');
    expect(report.adminId).toBe(null);
    expect(report.adminPriority).toBe(null);
    expect(report.adminDeadline).toBe(null);
    expect(report.adminNotes).toBe(null);
    expect(report.status).toBe(ReportStatus.PENDING_VERIFICATION);
    expect(report.ownerNotes).toBe(null);
    expect(report.reviewerId).toBe(null);
    expect(report.reviewerNotes).toBe(null);
    expect(report.reviewerTimestamp).toBe(null);
    expect(report.verificationToken).toBe(null);
    expect(report.verificationExpiration).toBe(null);
    expect(report.escalationType).toBe(null);
    expect(report.createdAt).toBeInstanceOf(Date);
    expect(report.updatedAt).toBeInstanceOf(Date);
  });

  it('should create instance with provided id', () => {
    const report = new Report('my-report-id');
    expect(report.id).toBe('my-report-id');
  });

  it('should allow setting all properties', () => {
    const report = createFullReport();

    expect(report.id).toBe('report-id-1');
    expect(report.eventId).toBe('event-id-1');
    expect(report.calendarId).toBe('calendar-id-1');
    expect(report.category).toBe(ReportCategory.SPAM);
    expect(report.description).toBe('This event is spam');
    expect(report.reporterEmailHash).toBe('abc123hash');
    expect(report.reporterAccountId).toBe(null);
    expect(report.reporterType).toBe('anonymous');
    expect(report.status).toBe(ReportStatus.SUBMITTED);
    expect(report.createdAt).toBe(sampleDate);
    expect(report.updatedAt).toBe(sampleDate);
  });

  describe('toObject', () => {

    it('should serialize all properties to a plain object', () => {
      const report = createFullReport();
      const obj = report.toObject();

      expect(obj).toEqual({
        id: 'report-id-1',
        eventId: 'event-id-1',
        calendarId: 'calendar-id-1',
        category: 'spam',
        description: 'This event is spam',
        reporterEmailHash: 'abc123hash',
        reporterAccountId: null,
        reporterType: 'anonymous',
        adminId: null,
        adminPriority: null,
        adminDeadline: null,
        adminNotes: null,
        status: 'submitted',
        ownerNotes: null,
        reviewerId: null,
        reviewerNotes: null,
        reviewerTimestamp: null,
        verificationToken: null,
        verificationExpiration: null,
        escalationType: null,
        createdAt: sampleDate.toISOString(),
        updatedAt: sampleDate.toISOString(),
      });
    });

    it('should serialize nullable fields with values', () => {
      const report = createFullReport();
      report.reporterAccountId = 'account-id-1';
      report.adminId = 'admin-id-1';
      report.adminPriority = 'high';
      report.adminDeadline = sampleDate2;
      report.adminNotes = 'Needs urgent review';
      report.ownerNotes = 'Owner reviewed';
      report.reviewerId = 'reviewer-id-1';
      report.reviewerNotes = 'Looks fine';
      report.reviewerTimestamp = sampleDate2;
      report.verificationToken = 'token-abc';
      report.verificationExpiration = sampleDate2;
      report.escalationType = 'manual';

      const obj = report.toObject();

      expect(obj.reporterAccountId).toBe('account-id-1');
      expect(obj.adminId).toBe('admin-id-1');
      expect(obj.adminPriority).toBe('high');
      expect(obj.adminDeadline).toBe(sampleDate2.toISOString());
      expect(obj.adminNotes).toBe('Needs urgent review');
      expect(obj.ownerNotes).toBe('Owner reviewed');
      expect(obj.reviewerId).toBe('reviewer-id-1');
      expect(obj.reviewerNotes).toBe('Looks fine');
      expect(obj.reviewerTimestamp).toBe(sampleDate2.toISOString());
      expect(obj.verificationToken).toBe('token-abc');
      expect(obj.verificationExpiration).toBe(sampleDate2.toISOString());
      expect(obj.escalationType).toBe('manual');
    });
  });

  describe('toReporterObject', () => {

    it('should return only reporter-safe fields', () => {
      const report = createFullReport();
      const obj = report.toReporterObject();

      expect(obj).toEqual({
        id: 'report-id-1',
        eventId: 'event-id-1',
        category: 'spam',
        description: 'This event is spam',
        status: 'submitted',
        createdAt: sampleDate.toISOString(),
      });
    });

    it('should not include sensitive fields even when populated', () => {
      const report = createFullyPopulatedReport();
      const obj = report.toReporterObject();

      // Verify only safe fields are present
      const keys = Object.keys(obj);
      expect(keys).toEqual(['id', 'eventId', 'category', 'description', 'status', 'createdAt']);

      // Explicitly verify no sensitive fields
      expect(obj).not.toHaveProperty('verificationToken');
      expect(obj).not.toHaveProperty('verificationExpiration');
      expect(obj).not.toHaveProperty('reporterEmailHash');
      expect(obj).not.toHaveProperty('reporterAccountId');
      expect(obj).not.toHaveProperty('adminNotes');
      expect(obj).not.toHaveProperty('adminId');
      expect(obj).not.toHaveProperty('adminPriority');
      expect(obj).not.toHaveProperty('adminDeadline');
      expect(obj).not.toHaveProperty('reviewerNotes');
      expect(obj).not.toHaveProperty('reviewerId');
      expect(obj).not.toHaveProperty('reviewerTimestamp');
      expect(obj).not.toHaveProperty('ownerNotes');
      expect(obj).not.toHaveProperty('calendarId');
      expect(obj).not.toHaveProperty('reporterType');
      expect(obj).not.toHaveProperty('escalationType');
      expect(obj).not.toHaveProperty('updatedAt');
    });

    it('should serialize createdAt as ISO string', () => {
      const report = createFullReport();
      const obj = report.toReporterObject();

      expect(obj.createdAt).toBe(sampleDate.toISOString());
    });
  });

  describe('toOwnerObject', () => {

    it('should return reporter-safe fields plus reporterType', () => {
      const report = createFullReport();
      const obj = report.toOwnerObject();

      expect(obj).toEqual({
        id: 'report-id-1',
        eventId: 'event-id-1',
        category: 'spam',
        description: 'This event is spam',
        status: 'submitted',
        reporterType: 'anonymous',
        createdAt: sampleDate.toISOString(),
      });
    });

    it('should not include sensitive fields even when populated', () => {
      const report = createFullyPopulatedReport();
      const obj = report.toOwnerObject();

      // Verify expected keys
      const keys = Object.keys(obj);
      expect(keys).toEqual(['id', 'eventId', 'category', 'description', 'status', 'reporterType', 'createdAt']);

      // Explicitly verify no sensitive fields
      expect(obj).not.toHaveProperty('verificationToken');
      expect(obj).not.toHaveProperty('verificationExpiration');
      expect(obj).not.toHaveProperty('reporterEmailHash');
      expect(obj).not.toHaveProperty('reporterAccountId');
      expect(obj).not.toHaveProperty('adminNotes');
      expect(obj).not.toHaveProperty('adminId');
      expect(obj).not.toHaveProperty('adminPriority');
      expect(obj).not.toHaveProperty('adminDeadline');
      expect(obj).not.toHaveProperty('reviewerNotes');
      expect(obj).not.toHaveProperty('reviewerId');
      expect(obj).not.toHaveProperty('reviewerTimestamp');
      expect(obj).not.toHaveProperty('ownerNotes');
    });

    it('should include reporterType for authenticated reports', () => {
      const report = createFullyPopulatedReport();
      const obj = report.toOwnerObject();

      expect(obj.reporterType).toBe('authenticated');
    });
  });

  describe('toAdminObject', () => {

    it('should return all fields needed for admin review', () => {
      const report = createFullyPopulatedReport();
      const obj = report.toAdminObject();

      expect(obj).toEqual({
        id: 'report-id-1',
        eventId: 'event-id-1',
        calendarId: 'calendar-id-1',
        category: 'spam',
        description: 'This event is spam',
        reporterEmailHash: 'hash-abc123',
        reporterAccountId: 'account-id-1',
        reporterType: 'authenticated',
        adminId: 'admin-id-1',
        adminPriority: 'high',
        adminDeadline: sampleDate2.toISOString(),
        adminNotes: 'Needs urgent review',
        status: 'under_review',
        ownerNotes: 'Owner reviewed this',
        reviewerId: 'reviewer-id-1',
        reviewerNotes: 'Confirmed issue',
        reviewerTimestamp: sampleDate2.toISOString(),
        escalationType: 'manual',
        createdAt: sampleDate.toISOString(),
        updatedAt: sampleDate2.toISOString(),
      });
    });

    it('should never include verificationToken or verificationExpiration', () => {
      const report = createFullyPopulatedReport();
      const obj = report.toAdminObject();

      expect(obj).not.toHaveProperty('verificationToken');
      expect(obj).not.toHaveProperty('verificationExpiration');
    });

    it('should handle nullable admin fields when null', () => {
      const report = createFullReport();
      const obj = report.toAdminObject();

      expect(obj.adminId).toBe(null);
      expect(obj.adminPriority).toBe(null);
      expect(obj.adminDeadline).toBe(null);
      expect(obj.adminNotes).toBe(null);
      expect(obj.ownerNotes).toBe(null);
      expect(obj.reviewerId).toBe(null);
      expect(obj.reviewerNotes).toBe(null);
      expect(obj.reviewerTimestamp).toBe(null);
      expect(obj.escalationType).toBe(null);
    });

    it('should serialize date fields as ISO strings', () => {
      const report = createFullyPopulatedReport();
      const obj = report.toAdminObject();

      expect(obj.createdAt).toBe(sampleDate.toISOString());
      expect(obj.updatedAt).toBe(sampleDate2.toISOString());
      expect(obj.adminDeadline).toBe(sampleDate2.toISOString());
      expect(obj.reviewerTimestamp).toBe(sampleDate2.toISOString());
    });
  });

  describe('fromObject', () => {

    it('should create a Report from a plain object', () => {
      const obj = {
        id: 'report-id-1',
        eventId: 'event-id-1',
        calendarId: 'calendar-id-1',
        category: 'spam',
        description: 'This event is spam',
        reporterEmailHash: 'abc123hash',
        reporterAccountId: null,
        reporterType: 'anonymous',
        adminId: null,
        adminPriority: null,
        adminDeadline: null,
        adminNotes: null,
        status: 'submitted',
        ownerNotes: null,
        reviewerId: null,
        reviewerNotes: null,
        reviewerTimestamp: null,
        verificationToken: null,
        verificationExpiration: null,
        escalationType: null,
        createdAt: sampleDate.toISOString(),
        updatedAt: sampleDate.toISOString(),
      };

      const report = Report.fromObject(obj);

      expect(report).toBeInstanceOf(Report);
      expect(report.id).toBe('report-id-1');
      expect(report.eventId).toBe('event-id-1');
      expect(report.calendarId).toBe('calendar-id-1');
      expect(report.category).toBe(ReportCategory.SPAM);
      expect(report.description).toBe('This event is spam');
      expect(report.reporterEmailHash).toBe('abc123hash');
      expect(report.reporterAccountId).toBe(null);
      expect(report.reporterType).toBe('anonymous');
      expect(report.status).toBe(ReportStatus.SUBMITTED);
      expect(report.createdAt).toEqual(sampleDate);
      expect(report.updatedAt).toEqual(sampleDate);
    });

    it('should handle nullable date fields with values', () => {
      const obj = {
        id: 'report-id-2',
        eventId: 'event-id-2',
        calendarId: 'calendar-id-2',
        category: 'harassment',
        description: 'Harassing content',
        reporterEmailHash: null,
        reporterAccountId: 'account-id-1',
        reporterType: 'authenticated',
        adminId: 'admin-id-1',
        adminPriority: 'high',
        adminDeadline: sampleDate2.toISOString(),
        adminNotes: 'Urgent',
        status: 'under_review',
        ownerNotes: 'Reviewing',
        reviewerId: 'reviewer-id-1',
        reviewerNotes: 'In progress',
        reviewerTimestamp: sampleDate2.toISOString(),
        verificationToken: null,
        verificationExpiration: null,
        escalationType: 'automatic',
        createdAt: sampleDate.toISOString(),
        updatedAt: sampleDate2.toISOString(),
      };

      const report = Report.fromObject(obj);

      expect(report.adminDeadline).toEqual(sampleDate2);
      expect(report.reviewerTimestamp).toEqual(sampleDate2);
      expect(report.escalationType).toBe('automatic');
      expect(report.reporterType).toBe('authenticated');
      expect(report.adminPriority).toBe('high');
    });

    it('should handle missing optional fields gracefully', () => {
      const obj = {
        id: 'report-id-3',
        eventId: 'event-id-3',
        calendarId: 'calendar-id-3',
        category: 'other',
        description: 'Something wrong',
        reporterType: 'anonymous',
        status: 'pending_verification',
        createdAt: sampleDate.toISOString(),
        updatedAt: sampleDate.toISOString(),
      };

      const report = Report.fromObject(obj);

      expect(report.reporterEmailHash).toBe(null);
      expect(report.reporterAccountId).toBe(null);
      expect(report.adminId).toBe(null);
      expect(report.adminPriority).toBe(null);
      expect(report.adminDeadline).toBe(null);
      expect(report.adminNotes).toBe(null);
      expect(report.ownerNotes).toBe(null);
      expect(report.reviewerId).toBe(null);
      expect(report.reviewerNotes).toBe(null);
      expect(report.reviewerTimestamp).toBe(null);
      expect(report.verificationToken).toBe(null);
      expect(report.verificationExpiration).toBe(null);
      expect(report.escalationType).toBe(null);
    });
  });

  describe('serialization round-trip', () => {

    it('should maintain data integrity through toObject-fromObject with minimal data', () => {
      const original = new Report('round-trip-1');
      original.eventId = 'event-1';
      original.calendarId = 'calendar-1';
      original.category = ReportCategory.MISLEADING;
      original.description = 'Misleading event info';
      original.reporterType = 'anonymous';
      original.status = ReportStatus.PENDING_VERIFICATION;
      original.createdAt = sampleDate;
      original.updatedAt = sampleDate;

      const obj = original.toObject();
      const roundTrip = Report.fromObject(obj);

      expect(roundTrip.id).toBe(original.id);
      expect(roundTrip.eventId).toBe(original.eventId);
      expect(roundTrip.calendarId).toBe(original.calendarId);
      expect(roundTrip.category).toBe(original.category);
      expect(roundTrip.description).toBe(original.description);
      expect(roundTrip.reporterType).toBe(original.reporterType);
      expect(roundTrip.status).toBe(original.status);
      expect(roundTrip.createdAt).toEqual(original.createdAt);
      expect(roundTrip.updatedAt).toEqual(original.updatedAt);
    });

    it('should maintain data integrity through toObject-fromObject with all fields populated', () => {
      const original = new Report('round-trip-2');
      original.eventId = 'event-2';
      original.calendarId = 'calendar-2';
      original.category = ReportCategory.HARASSMENT;
      original.description = 'Harassment in event';
      original.reporterEmailHash = 'hash-xyz';
      original.reporterAccountId = 'account-99';
      original.reporterType = 'authenticated';
      original.adminId = 'admin-42';
      original.adminPriority = 'medium';
      original.adminDeadline = sampleDate2;
      original.adminNotes = 'Review by Friday';
      original.status = ReportStatus.UNDER_REVIEW;
      original.ownerNotes = 'Owner says valid';
      original.reviewerId = 'reviewer-7';
      original.reviewerNotes = 'Confirmed issue';
      original.reviewerTimestamp = sampleDate2;
      original.verificationToken = 'verify-token-abc';
      original.verificationExpiration = sampleDate2;
      original.escalationType = 'manual';
      original.createdAt = sampleDate;
      original.updatedAt = sampleDate2;

      const obj = original.toObject();
      const roundTrip = Report.fromObject(obj);

      expect(roundTrip.id).toBe(original.id);
      expect(roundTrip.eventId).toBe(original.eventId);
      expect(roundTrip.calendarId).toBe(original.calendarId);
      expect(roundTrip.category).toBe(original.category);
      expect(roundTrip.description).toBe(original.description);
      expect(roundTrip.reporterEmailHash).toBe(original.reporterEmailHash);
      expect(roundTrip.reporterAccountId).toBe(original.reporterAccountId);
      expect(roundTrip.reporterType).toBe(original.reporterType);
      expect(roundTrip.adminId).toBe(original.adminId);
      expect(roundTrip.adminPriority).toBe(original.adminPriority);
      expect(roundTrip.adminDeadline).toEqual(original.adminDeadline);
      expect(roundTrip.adminNotes).toBe(original.adminNotes);
      expect(roundTrip.status).toBe(original.status);
      expect(roundTrip.ownerNotes).toBe(original.ownerNotes);
      expect(roundTrip.reviewerId).toBe(original.reviewerId);
      expect(roundTrip.reviewerNotes).toBe(original.reviewerNotes);
      expect(roundTrip.reviewerTimestamp).toEqual(original.reviewerTimestamp);
      expect(roundTrip.verificationToken).toBe(original.verificationToken);
      expect(roundTrip.verificationExpiration).toEqual(original.verificationExpiration);
      expect(roundTrip.escalationType).toBe(original.escalationType);
      expect(roundTrip.createdAt).toEqual(original.createdAt);
      expect(roundTrip.updatedAt).toEqual(original.updatedAt);
    });
  });

  describe('computed properties', () => {

    describe('isVerified', () => {

      it('should return false when status is pending_verification', () => {
        const report = new Report('r1');
        report.status = ReportStatus.PENDING_VERIFICATION;
        expect(report.isVerified).toBe(false);
      });

      it('should return true when status is submitted', () => {
        const report = new Report('r1');
        report.status = ReportStatus.SUBMITTED;
        expect(report.isVerified).toBe(true);
      });

      it('should return true when status is under_review', () => {
        const report = new Report('r1');
        report.status = ReportStatus.UNDER_REVIEW;
        expect(report.isVerified).toBe(true);
      });

      it('should return true when status is resolved', () => {
        const report = new Report('r1');
        report.status = ReportStatus.RESOLVED;
        expect(report.isVerified).toBe(true);
      });

      it('should return true when status is dismissed', () => {
        const report = new Report('r1');
        report.status = ReportStatus.DISMISSED;
        expect(report.isVerified).toBe(true);
      });

      it('should return true when status is escalated', () => {
        const report = new Report('r1');
        report.status = ReportStatus.ESCALATED;
        expect(report.isVerified).toBe(true);
      });
    });

    describe('isPending', () => {

      it('should return true when status is pending_verification', () => {
        const report = new Report('r1');
        report.status = ReportStatus.PENDING_VERIFICATION;
        expect(report.isPending).toBe(true);
      });

      it('should return true when status is submitted', () => {
        const report = new Report('r1');
        report.status = ReportStatus.SUBMITTED;
        expect(report.isPending).toBe(true);
      });

      it('should return false when status is under_review', () => {
        const report = new Report('r1');
        report.status = ReportStatus.UNDER_REVIEW;
        expect(report.isPending).toBe(false);
      });

      it('should return false when status is resolved', () => {
        const report = new Report('r1');
        report.status = ReportStatus.RESOLVED;
        expect(report.isPending).toBe(false);
      });

      it('should return false when status is dismissed', () => {
        const report = new Report('r1');
        report.status = ReportStatus.DISMISSED;
        expect(report.isPending).toBe(false);
      });

      it('should return false when status is escalated', () => {
        const report = new Report('r1');
        report.status = ReportStatus.ESCALATED;
        expect(report.isPending).toBe(false);
      });
    });

    describe('isEscalated', () => {

      it('should return true when status is escalated', () => {
        const report = new Report('r1');
        report.status = ReportStatus.ESCALATED;
        expect(report.isEscalated).toBe(true);
      });

      it('should return false when status is not escalated', () => {
        const statuses = [
          ReportStatus.PENDING_VERIFICATION,
          ReportStatus.SUBMITTED,
          ReportStatus.UNDER_REVIEW,
          ReportStatus.RESOLVED,
          ReportStatus.DISMISSED,
        ];

        for (const status of statuses) {
          const report = new Report('r1');
          report.status = status;
          expect(report.isEscalated).toBe(false);
        }
      });
    });

    describe('isResolved', () => {

      it('should return true when status is resolved', () => {
        const report = new Report('r1');
        report.status = ReportStatus.RESOLVED;
        expect(report.isResolved).toBe(true);
      });

      it('should return true when status is dismissed', () => {
        const report = new Report('r1');
        report.status = ReportStatus.DISMISSED;
        expect(report.isResolved).toBe(true);
      });

      it('should return false for non-terminal statuses', () => {
        const statuses = [
          ReportStatus.PENDING_VERIFICATION,
          ReportStatus.SUBMITTED,
          ReportStatus.UNDER_REVIEW,
          ReportStatus.ESCALATED,
        ];

        for (const status of statuses) {
          const report = new Report('r1');
          report.status = status;
          expect(report.isResolved).toBe(false);
        }
      });
    });
  });
});
