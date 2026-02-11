import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import EmailBlockingService from '../../service/email-blocking';
import ModerationService from '../../service/moderation';
import { BlockedReporterEntity } from '../../entity/blocked_reporter';
import { ReportEntity } from '../../entity/report';
import { EventReporterEntity } from '../../entity/event_reporter';
import { Account } from '@/common/model/account';
import { AccountEntity } from '@/server/common/entity/account';
import { ReportCategory } from '@/common/model/report';
import { ReporterBlockedError } from '../../exceptions';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import { v4 as uuidv4 } from 'uuid';

describe('EmailBlockingService Integration', () => {
  let service: EmailBlockingService;
  let adminAccount: Account;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    service = new EmailBlockingService();

    // Create a test admin account
    const adminId = uuidv4();
    adminAccount = new Account(adminId);
    adminAccount.email = 'admin@test.com';
    adminAccount.displayName = 'Admin User';

    await AccountEntity.create({
      id: adminId,
      email: 'admin@test.com',
      display_name: 'Admin User',
      password: 'hashed-password',
      status: 'active',
      is_admin: true,
    });
  });

  afterEach(async () => {
    // Clean up test data
    await BlockedReporterEntity.destroy({ where: {} });
    await AccountEntity.destroy({ where: {} });
  });

  describe('blockReporter and isEmailBlocked', () => {
    it('should block a reporter and verify the block', async () => {
      const email = 'spammer@example.com';
      const reason = 'Repeated spam reports';

      // Initially not blocked
      const emailHash = service.hashEmail(email);
      let isBlocked = await service.isEmailBlocked(emailHash);
      expect(isBlocked).toBe(false);

      // Block the reporter
      const blockedReporter = await service.blockReporter(email, adminAccount, reason);

      expect(blockedReporter.emailHash).toBe(emailHash);
      expect(blockedReporter.blockedBy).toBe(adminAccount.id);
      expect(blockedReporter.reason).toBe(reason);
      expect(blockedReporter.createdAt).toBeInstanceOf(Date);

      // Verify the block
      isBlocked = await service.isEmailBlocked(emailHash);
      expect(isBlocked).toBe(true);

      // Verify database persistence
      const dbRecord = await BlockedReporterEntity.findOne({
        where: { email_hash: emailHash },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord!.email_hash).toBe(emailHash);
      expect(dbRecord!.blocked_by).toBe(adminAccount.id);
      expect(dbRecord!.reason).toBe(reason);
    });

    it('should handle email normalization consistently', async () => {
      const emailVariations = [
        '  Test@Example.COM  ',
        'test@example.com',
        'TEST@EXAMPLE.COM',
        'test@example.com  ',
      ];

      // Block using first variation
      await service.blockReporter(emailVariations[0], adminAccount, 'Test block');

      // All variations should be blocked
      for (const email of emailVariations) {
        const hash = service.hashEmail(email);
        const isBlocked = await service.isEmailBlocked(hash);
        expect(isBlocked).toBe(true);
      }
    });
  });

  describe('unblockReporter', () => {
    it('should unblock a reporter', async () => {
      const email = 'reporter@example.com';
      const reason = 'Mistaken block';

      // Block the reporter
      const blockedReporter = await service.blockReporter(email, adminAccount, reason);
      const emailHash = blockedReporter.emailHash;

      // Verify blocked
      let isBlocked = await service.isEmailBlocked(emailHash);
      expect(isBlocked).toBe(true);

      // Unblock the reporter
      await service.unblockReporter(emailHash);

      // Verify unblocked
      isBlocked = await service.isEmailBlocked(emailHash);
      expect(isBlocked).toBe(false);

      // Verify database removal
      const dbRecord = await BlockedReporterEntity.findOne({
        where: { email_hash: emailHash },
      });
      expect(dbRecord).toBeNull();
    });

    it('should be idempotent when unblocking non-existent hash', async () => {
      const nonExistentHash = 'nonexistent-hash-123';

      // Should not throw
      await expect(service.unblockReporter(nonExistentHash)).resolves.not.toThrow();

      // Verify still not blocked
      const isBlocked = await service.isEmailBlocked(nonExistentHash);
      expect(isBlocked).toBe(false);
    });
  });

  describe('listBlockedReporters', () => {
    it('should return all blocked reporters ordered by creation date desc', async () => {
      const emails = [
        { email: 'spammer1@example.com', reason: 'Spam' },
        { email: 'spammer2@example.com', reason: 'Abuse' },
        { email: 'spammer3@example.com', reason: 'Harassment' },
      ];

      // Block reporters with slight delays to ensure different timestamps
      for (const { email, reason } of emails) {
        await service.blockReporter(email, adminAccount, reason);
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      const blockedReporters = await service.listBlockedReporters();

      expect(blockedReporters).toHaveLength(3);

      // Should be ordered by created_at DESC (newest first)
      expect(blockedReporters[0].reason).toBe('Harassment');
      expect(blockedReporters[1].reason).toBe('Abuse');
      expect(blockedReporters[2].reason).toBe('Spam');

      // All should have admin info
      blockedReporters.forEach(reporter => {
        expect(reporter.blockedBy).toBe(adminAccount.id);
        expect(reporter.emailHash).toMatch(/^[a-f0-9]{64}$/);
        expect(reporter.createdAt).toBeInstanceOf(Date);
      });
    });

    it('should return empty array when no reporters are blocked', async () => {
      const blockedReporters = await service.listBlockedReporters();

      expect(blockedReporters).toEqual([]);
    });

    it('should not include unblocked reporters', async () => {
      const email1 = 'blocked@example.com';
      const email2 = 'unblocked@example.com';

      // Block both
      await service.blockReporter(email1, adminAccount, 'Block 1');
      const blocked2 = await service.blockReporter(email2, adminAccount, 'Block 2');

      // Verify both are listed
      let blockedReporters = await service.listBlockedReporters();
      expect(blockedReporters).toHaveLength(2);

      // Unblock one
      await service.unblockReporter(blocked2.emailHash);

      // Verify only one is listed
      blockedReporters = await service.listBlockedReporters();
      expect(blockedReporters).toHaveLength(1);
      expect(blockedReporters[0].emailHash).toBe(service.hashEmail(email1));
    });
  });

  describe('multiple admins', () => {
    it('should track different admins blocking different reporters', async () => {
      // Create second admin
      const admin2Id = uuidv4();
      const admin2Account = new Account(admin2Id);
      admin2Account.email = 'admin2@test.com';
      admin2Account.displayName = 'Admin User 2';

      await AccountEntity.create({
        id: admin2Id,
        email: 'admin2@test.com',
        display_name: 'Admin User 2',
        password: 'hashed-password',
        status: 'active',
        is_admin: true,
      });

      // Each admin blocks a reporter
      await service.blockReporter('spam1@example.com', adminAccount, 'Blocked by admin 1');
      await service.blockReporter('spam2@example.com', admin2Account, 'Blocked by admin 2');

      const blockedReporters = await service.listBlockedReporters();

      expect(blockedReporters).toHaveLength(2);

      // Find by admin
      const blockedByAdmin1 = blockedReporters.find(r => r.blockedBy === adminAccount.id);
      const blockedByAdmin2 = blockedReporters.find(r => r.blockedBy === admin2Id);

      expect(blockedByAdmin1).toBeDefined();
      expect(blockedByAdmin1!.reason).toBe('Blocked by admin 1');
      expect(blockedByAdmin2).toBeDefined();
      expect(blockedByAdmin2!.reason).toBe('Blocked by admin 2');
    });
  });
});

describe('ModerationService - Report Submission with Email Blocking', () => {
  let moderationService: ModerationService;
  let emailBlockingService: EmailBlockingService;
  let adminAccount: Account;
  let eventBus: EventEmitter;
  let env: TestEnvironment;

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    eventBus = new EventEmitter();
    moderationService = new ModerationService(eventBus);
    emailBlockingService = new EmailBlockingService();

    // Create a test admin account
    const adminId = uuidv4();
    adminAccount = new Account(adminId);
    adminAccount.email = 'admin@test.com';
    adminAccount.displayName = 'Admin User';

    await AccountEntity.create({
      id: adminId,
      email: 'admin@test.com',
      display_name: 'Admin User',
      password: 'hashed-password',
      status: 'active',
      is_admin: true,
    });
  });

  afterEach(async () => {
    // Clean up test data
    await ReportEntity.destroy({ where: {} });
    await EventReporterEntity.destroy({ where: {} });
    await BlockedReporterEntity.destroy({ where: {} });
    await AccountEntity.destroy({ where: {} });
  });

  describe('createReport with blocked email', () => {
    it('should reject anonymous report submission when email is blocked', async () => {
      const blockedEmail = 'spammer@example.com';
      const eventId = uuidv4();
      const calendarId = uuidv4();

      // Block the email first
      await emailBlockingService.blockReporter(blockedEmail, adminAccount, 'Spam reports');

      // Attempt to create a report with blocked email
      await expect(moderationService.createReport({
        eventId,
        calendarId,
        category: ReportCategory.SPAM,
        description: 'This is spam',
        reporterEmail: blockedEmail,
        reporterType: 'anonymous',
      })).rejects.toThrow(ReporterBlockedError);

      // Verify no report was created
      const reports = await ReportEntity.findAll({
        where: { event_id: eventId },
      });
      expect(reports).toHaveLength(0);
    });

    it('should allow report submission after unblocking email', async () => {
      const email = 'reporter@example.com';
      const eventId = uuidv4();
      const calendarId = uuidv4();

      // Block the email
      const blocked = await emailBlockingService.blockReporter(email, adminAccount, 'Test block');

      // Verify blocked - should reject
      await expect(moderationService.createReport({
        eventId,
        calendarId,
        category: ReportCategory.SPAM,
        description: 'Test',
        reporterEmail: email,
        reporterType: 'anonymous',
      })).rejects.toThrow(ReporterBlockedError);

      // Unblock the email
      await emailBlockingService.unblockReporter(blocked.emailHash);

      // Now should succeed
      const report = await moderationService.createReport({
        eventId,
        calendarId,
        category: ReportCategory.SPAM,
        description: 'Test report',
        reporterEmail: email,
        reporterType: 'anonymous',
      });

      expect(report).toBeDefined();
      expect(report.eventId).toBe(eventId);

      // Verify report was created
      const reports = await ReportEntity.findAll({
        where: { event_id: eventId },
      });
      expect(reports).toHaveLength(1);
    });

    it('should handle email normalization in blocking check', async () => {
      const emailVariations = [
        'Test@Example.COM',
        'test@example.com',
        '  TEST@example.com  ',
      ];
      const eventId = uuidv4();
      const calendarId = uuidv4();

      // Block using first variation
      await emailBlockingService.blockReporter(emailVariations[0], adminAccount, 'Test');

      // All variations should be rejected
      for (const email of emailVariations) {
        await expect(moderationService.createReport({
          eventId,
          calendarId,
          category: ReportCategory.SPAM,
          description: 'Test',
          reporterEmail: email,
          reporterType: 'anonymous',
        })).rejects.toThrow(ReporterBlockedError);
      }

      // No reports should be created
      const reports = await ReportEntity.findAll({
        where: { event_id: eventId },
      });
      expect(reports).toHaveLength(0);
    });

    it('should not check blocking for authenticated reporters', async () => {
      const email = 'blocked@example.com';
      const eventId = uuidv4();
      const calendarId = uuidv4();
      const accountId = uuidv4();

      // Block the email
      await emailBlockingService.blockReporter(email, adminAccount, 'Test');

      // Authenticated report should still work
      const report = await moderationService.createReport({
        eventId,
        calendarId,
        category: ReportCategory.SPAM,
        description: 'Auth report',
        reporterAccountId: accountId,
        reporterType: 'authenticated',
      });

      expect(report).toBeDefined();
      expect(report.reporterType).toBe('authenticated');

      // Verify report was created
      const reports = await ReportEntity.findAll({
        where: { event_id: eventId },
      });
      expect(reports).toHaveLength(1);
    });

    it('should not check blocking for admin reporters', async () => {
      const email = 'blocked@example.com';
      const eventId = uuidv4();
      const calendarId = uuidv4();

      // Block the email
      await emailBlockingService.blockReporter(email, adminAccount, 'Test');

      // Admin report should still work
      const report = await moderationService.createReport({
        eventId,
        calendarId,
        category: ReportCategory.SPAM,
        description: 'Admin report',
        reporterAccountId: adminAccount.id,
        reporterType: 'administrator',
        adminId: adminAccount.id,
        adminPriority: 'high',
      });

      expect(report).toBeDefined();
      expect(report.reporterType).toBe('administrator');

      // Verify report was created
      const reports = await ReportEntity.findAll({
        where: { event_id: eventId },
      });
      expect(reports).toHaveLength(1);
    });
  });
});
