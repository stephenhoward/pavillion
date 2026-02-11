import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { TestEnvironment } from '@/server/test/lib/test_environment';
import { Account } from '@/common/model/account';
import { AccountEntity } from '@/server/common/entity/account';
import { BlockedReporterEntity } from '@/server/moderation/entity/blocked_reporter';
import ModerationInterface from '@/server/moderation/interface';
import BlockedReportersRoutes from '@/server/moderation/api/v1/blocked-reporters-routes';
import EmailBlockingService from '@/server/moderation/service/email-blocking';
import ExpressHelper from '@/server/common/helper/express';

describe('BlockedReportersRoutes API Integration', () => {
  let moderationInterface: ModerationInterface;
  let emailBlockingService: EmailBlockingService;
  let adminAccount: Account;
  let nonAdminAccount: Account;
  let env: TestEnvironment;
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();

  /**
   * Creates a test Express app with admin auth stubbed.
   */
  function createAppWithAuth(isAdmin: boolean = true) {
    const testApp = express();
    testApp.use(express.json());

    testApp.use((req, _res, next) => {
      const account = isAdmin ? adminAccount : nonAdminAccount;
      (req as any).user = account;
      next();
    });

    const routes = new BlockedReportersRoutes(moderationInterface);
    routes.installHandlers(testApp, '/api/v1');

    return testApp;
  }

  /**
   * Creates a test Express app with no user (unauthenticated).
   */
  function createAppNoAuth() {
    const testApp = express();
    testApp.use(express.json());

    const routes = new BlockedReportersRoutes(moderationInterface);
    routes.installHandlers(testApp, '/api/v1');

    return testApp;
  }

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    // Create moderation interface
    moderationInterface = new ModerationInterface(
      env.eventBus,
      env.calendarInterface,
      env.accountsInterface,
      env.emailInterface,
      env.configurationInterface,
      env.activityPubInterface,
    );

    emailBlockingService = new EmailBlockingService();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  beforeEach(async () => {
    // Stub ExpressHelper.adminOnly to avoid Passport JWT dependency
    sandbox.stub(ExpressHelper, 'adminOnly').value([
      (req: any, res: any, next: any) => {
        if (!req.user) {
          res.status(401).json({ message: 'unauthorized' });
        }
        else if (req.user.hasRole('admin')) {
          next();
        }
        else {
          res.status(403).json({ error: 'Only administrators can access this resource' });
        }
      },
    ]);

    // Create admin account
    const adminId = uuidv4();
    adminAccount = new Account(adminId);
    adminAccount.email = 'admin@test.com';
    adminAccount.displayName = 'Admin User';
    adminAccount.roles = ['admin'];

    await AccountEntity.create({
      id: adminId,
      email: 'admin@test.com',
      display_name: 'Admin User',
      password: 'hashed-password',
      status: 'active',
      is_admin: true,
    });

    // Create non-admin account
    const userId = uuidv4();
    nonAdminAccount = new Account(userId);
    nonAdminAccount.email = 'user@test.com';
    nonAdminAccount.displayName = 'Regular User';
    nonAdminAccount.roles = [];

    await AccountEntity.create({
      id: userId,
      email: 'user@test.com',
      display_name: 'Regular User',
      password: 'hashed-password',
      status: 'active',
      is_admin: false,
    });
  });

  afterEach(async () => {
    sandbox.restore();
    await BlockedReporterEntity.destroy({ where: {} });
    await AccountEntity.destroy({ where: {} });
  });

  describe('GET /api/v1/admin/moderation/blocked-reporters', () => {
    it('should return empty array when no reporters are blocked', async () => {
      const app = createAppWithAuth(true);

      const response = await request(app)
        .get('/api/v1/admin/moderation/blocked-reporters')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return all blocked reporters', async () => {
      const app = createAppWithAuth(true);

      // Block three reporters
      const email1 = 'spammer1@example.com';
      const email2 = 'spammer2@example.com';
      const email3 = 'spammer3@example.com';

      await emailBlockingService.blockReporter(email1, adminAccount, 'Spam');
      await new Promise(resolve => setTimeout(resolve, 10));
      await emailBlockingService.blockReporter(email2, adminAccount, 'Abuse');
      await new Promise(resolve => setTimeout(resolve, 10));
      await emailBlockingService.blockReporter(email3, adminAccount, 'Harassment');

      const response = await request(app)
        .get('/api/v1/admin/moderation/blocked-reporters')
        .expect(200);

      expect(response.body).toHaveLength(3);

      // Should be ordered by creation date DESC
      expect(response.body[0].reason).toBe('Harassment');
      expect(response.body[1].reason).toBe('Abuse');
      expect(response.body[2].reason).toBe('Spam');

      // All should have correct structure
      response.body.forEach((reporter: any) => {
        expect(reporter).toHaveProperty('id');
        expect(reporter).toHaveProperty('emailHash');
        expect(reporter).toHaveProperty('blockedBy', adminAccount.id);
        expect(reporter).toHaveProperty('reason');
        expect(reporter).toHaveProperty('createdAt');
        expect(reporter.emailHash).toMatch(/^[a-f0-9]{64}$/);
      });
    });

    it('should return 403 for non-admin users', async () => {
      const app = createAppWithAuth(false);

      const response = await request(app)
        .get('/api/v1/admin/moderation/blocked-reporters')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('admin');
    });

    it('should return 401 for unauthenticated requests', async () => {
      const app = createAppNoAuth();

      await request(app)
        .get('/api/v1/admin/moderation/blocked-reporters')
        .expect(401);
    });

    it('should handle database errors gracefully', async () => {
      const app = createAppWithAuth(true);

      // Temporarily override the listBlockedReporters to throw an error
      const originalMethod = moderationInterface.listBlockedReporters;
      moderationInterface.listBlockedReporters = async () => {
        throw new Error('Database connection failed');
      };

      const response = await request(app)
        .get('/api/v1/admin/moderation/blocked-reporters')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Failed to retrieve blocked reporters');

      // Restore original method
      moderationInterface.listBlockedReporters = originalMethod;
    });
  });

  describe('POST /api/v1/admin/moderation/blocked-reporters', () => {
    it('should block a reporter with valid email and reason', async () => {
      const app = createAppWithAuth(true);

      const email = 'spammer@example.com';
      const reason = 'Repeated spam reports';

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email, reason })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('emailHash');
      expect(response.body.blockedBy).toBe(adminAccount.id);
      expect(response.body.reason).toBe(reason);
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body.emailHash).toMatch(/^[a-f0-9]{64}$/);

      // Verify in database
      const dbRecord = await BlockedReporterEntity.findOne({
        where: { email_hash: response.body.emailHash },
      });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord!.reason).toBe(reason);
    });

    it('should normalize email before blocking', async () => {
      const app = createAppWithAuth(true);

      const email = '  SPAMMER@Example.COM  ';
      const reason = 'Test block';

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email, reason })
        .expect(201);

      // Verify the hash matches normalized email
      const normalizedHash = emailBlockingService.hashEmail('spammer@example.com');
      expect(response.body.emailHash).toBe(normalizedHash);
    });

    it('should return 400 when email is missing', async () => {
      const app = createAppWithAuth(true);

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ reason: 'Test reason' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Email is required');
      expect(response.body).toHaveProperty('errorName', 'ValidationError');
    });

    it('should return 400 when email is empty string', async () => {
      const app = createAppWithAuth(true);

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: '   ', reason: 'Test reason' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Email is required');
      expect(response.body).toHaveProperty('errorName', 'ValidationError');
    });

    it('should return 400 when email is not a string', async () => {
      const app = createAppWithAuth(true);

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: 123, reason: 'Test reason' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Email is required');
      expect(response.body).toHaveProperty('errorName', 'ValidationError');
    });

    it('should return 400 when reason is missing', async () => {
      const app = createAppWithAuth(true);

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: 'test@example.com' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Reason is required');
      expect(response.body).toHaveProperty('errorName', 'ValidationError');
    });

    it('should return 400 when reason is empty string', async () => {
      const app = createAppWithAuth(true);

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: 'test@example.com', reason: '   ' })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Reason is required');
      expect(response.body).toHaveProperty('errorName', 'ValidationError');
    });

    it('should return 400 when reason is not a string', async () => {
      const app = createAppWithAuth(true);

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: 'test@example.com', reason: 123 })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Reason is required');
      expect(response.body).toHaveProperty('errorName', 'ValidationError');
    });

    it('should return 403 for non-admin users', async () => {
      const app = createAppWithAuth(false);

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: 'test@example.com', reason: 'Test' })
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('admin');
    });

    it('should return 401 for unauthenticated requests', async () => {
      const app = createAppNoAuth();

      await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: 'test@example.com', reason: 'Test' })
        .expect(401);
    });

    it('should handle database errors gracefully', async () => {
      const app = createAppWithAuth(true);

      // Temporarily override the blockReporter to throw an error
      const originalMethod = moderationInterface.blockReporter;
      moderationInterface.blockReporter = async () => {
        throw new Error('Database connection failed');
      };

      const response = await request(app)
        .post('/api/v1/admin/moderation/blocked-reporters')
        .send({ email: 'test@example.com', reason: 'Test' })
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Failed to block reporter');

      // Restore original method
      moderationInterface.blockReporter = originalMethod;
    });
  });

  describe('DELETE /api/v1/admin/moderation/blocked-reporters/:emailHash', () => {
    it('should unblock a reporter by email hash', async () => {
      const app = createAppWithAuth(true);

      // First block a reporter
      const email = 'spammer@example.com';
      const blockedReporter = await emailBlockingService.blockReporter(
        email,
        adminAccount,
        'Spam',
      );

      // Verify blocked
      let isBlocked = await emailBlockingService.isEmailBlocked(blockedReporter.emailHash);
      expect(isBlocked).toBe(true);

      // Unblock via API
      await request(app)
        .delete(`/api/v1/admin/moderation/blocked-reporters/${blockedReporter.emailHash}`)
        .expect(204);

      // Verify unblocked
      isBlocked = await emailBlockingService.isEmailBlocked(blockedReporter.emailHash);
      expect(isBlocked).toBe(false);

      // Verify removed from database
      const dbRecord = await BlockedReporterEntity.findOne({
        where: { email_hash: blockedReporter.emailHash },
      });
      expect(dbRecord).toBeNull();
    });

    it('should be idempotent when unblocking non-existent hash', async () => {
      const app = createAppWithAuth(true);

      const nonExistentHash = 'nonexistent-hash-123';

      // Should not throw - idempotent operation
      await request(app)
        .delete(`/api/v1/admin/moderation/blocked-reporters/${nonExistentHash}`)
        .expect(204);
    });

    it('should return 403 for non-admin users', async () => {
      const app = createAppWithAuth(false);

      const response = await request(app)
        .delete('/api/v1/admin/moderation/blocked-reporters/some-hash')
        .expect(403);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('admin');
    });

    it('should return 401 for unauthenticated requests', async () => {
      const app = createAppNoAuth();

      await request(app)
        .delete('/api/v1/admin/moderation/blocked-reporters/some-hash')
        .expect(401);
    });

    it('should handle database errors gracefully', async () => {
      const app = createAppWithAuth(true);

      // Temporarily override the unblockReporter to throw an error
      const originalMethod = moderationInterface.unblockReporter;
      moderationInterface.unblockReporter = async () => {
        throw new Error('Database connection failed');
      };

      const response = await request(app)
        .delete('/api/v1/admin/moderation/blocked-reporters/some-hash')
        .expect(500);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toContain('Failed to unblock reporter');

      // Restore original method
      moderationInterface.unblockReporter = originalMethod;
    });
  });
});
