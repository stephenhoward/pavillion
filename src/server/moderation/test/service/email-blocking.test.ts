import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import EmailBlockingService from '../../service/email-blocking';
import { BlockedReporterEntity } from '../../entity/blocked_reporter';
import { BlockedReporter } from '@/common/model/blocked_reporter';
import { Account } from '@/common/model/account';

describe('EmailBlockingService', () => {
  let sandbox: sinon.SinonSandbox;
  let service: EmailBlockingService;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new EmailBlockingService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('isEmailBlocked', () => {
    it('should return true if email hash exists in BlockedReporter table', async () => {
      const emailHash = 'abc123def456';
      const mockEntity = {
        id: 'blocked-id-1',
        email_hash: emailHash,
        blocked_by: 'admin-id',
        reason: 'Spam',
        created_at: new Date(),
      };

      const findOneStub = sandbox.stub(BlockedReporterEntity, 'findOne').resolves(mockEntity as any);

      const result = await service.isEmailBlocked(emailHash);

      expect(result).toBe(true);
      sinon.assert.calledOnceWithExactly(findOneStub, {
        where: { email_hash: emailHash },
      });
    });

    it('should return false if email hash does not exist in BlockedReporter table', async () => {
      const emailHash = 'nonexistent-hash';

      const findOneStub = sandbox.stub(BlockedReporterEntity, 'findOne').resolves(null);

      const result = await service.isEmailBlocked(emailHash);

      expect(result).toBe(false);
      sinon.assert.calledOnceWithExactly(findOneStub, {
        where: { email_hash: emailHash },
      });
    });
  });

  describe('blockReporter', () => {
    it('should create a BlockedReporter record with hashed email', async () => {
      const email = 'reporter@example.com';
      const adminAccount = new Account('admin-id');
      const reason = 'Abusive behavior';
      const emailHash = 'hashed-email-123';

      const mockEntity = {
        id: 'blocked-id-1',
        email_hash: emailHash,
        blocked_by: adminAccount.id,
        reason,
        created_at: new Date(),
        toModel: () => {
          const model = new BlockedReporter('blocked-id-1');
          model.emailHash = emailHash;
          model.blockedBy = adminAccount.id;
          model.reason = reason;
          model.createdAt = new Date();
          return model;
        },
      };

      const hashEmailStub = sandbox.stub(service, 'hashEmail').returns(emailHash);
      const createStub = sandbox.stub(BlockedReporterEntity, 'create').resolves(mockEntity as any);

      const result = await service.blockReporter(email, adminAccount, reason);

      sinon.assert.calledOnceWithExactly(hashEmailStub, email);
      sinon.assert.calledOnce(createStub);

      const createArgs = createStub.getCall(0).args[0];
      expect(createArgs.email_hash).toBe(emailHash);
      expect(createArgs.blocked_by).toBe(adminAccount.id);
      expect(createArgs.reason).toBe(reason);
      expect(createArgs.created_at).toBeInstanceOf(Date);

      expect(result).toBeInstanceOf(BlockedReporter);
      expect(result.emailHash).toBe(emailHash);
      expect(result.blockedBy).toBe(adminAccount.id);
      expect(result.reason).toBe(reason);
    });

    it('should handle empty reason by storing an empty string', async () => {
      const email = 'reporter@example.com';
      const adminAccount = new Account('admin-id');
      const reason = '';
      const emailHash = 'hashed-email-456';

      const mockEntity = {
        id: 'blocked-id-2',
        email_hash: emailHash,
        blocked_by: adminAccount.id,
        reason: '',
        created_at: new Date(),
        toModel: () => {
          const model = new BlockedReporter('blocked-id-2');
          model.emailHash = emailHash;
          model.blockedBy = adminAccount.id;
          model.reason = '';
          model.createdAt = new Date();
          return model;
        },
      };

      sandbox.stub(service, 'hashEmail').returns(emailHash);
      sandbox.stub(BlockedReporterEntity, 'create').resolves(mockEntity as any);

      const result = await service.blockReporter(email, adminAccount, reason);

      expect(result.reason).toBe('');
    });
  });

  describe('unblockReporter', () => {
    it('should remove BlockedReporter record by email hash', async () => {
      const emailHash = 'abc123def456';

      const destroyStub = sandbox.stub(BlockedReporterEntity, 'destroy').resolves(1);

      await service.unblockReporter(emailHash);

      sinon.assert.calledOnceWithExactly(destroyStub, {
        where: { email_hash: emailHash },
      });
    });

    it('should be idempotent when email hash does not exist', async () => {
      const emailHash = 'nonexistent-hash';

      const destroyStub = sandbox.stub(BlockedReporterEntity, 'destroy').resolves(0);

      await service.unblockReporter(emailHash);

      sinon.assert.calledOnceWithExactly(destroyStub, {
        where: { email_hash: emailHash },
      });
    });
  });

  describe('listBlockedReporters', () => {
    it('should return all blocked reporters with admin info', async () => {
      const mockEntities = [
        {
          id: 'blocked-id-1',
          email_hash: 'hash1',
          blocked_by: 'admin-id-1',
          reason: 'Spam',
          created_at: new Date('2025-01-01'),
          toModel: () => {
            const model = new BlockedReporter('blocked-id-1');
            model.emailHash = 'hash1';
            model.blockedBy = 'admin-id-1';
            model.reason = 'Spam';
            model.createdAt = new Date('2025-01-01');
            return model;
          },
        },
        {
          id: 'blocked-id-2',
          email_hash: 'hash2',
          blocked_by: 'admin-id-2',
          reason: 'Abusive behavior',
          created_at: new Date('2025-01-02'),
          toModel: () => {
            const model = new BlockedReporter('blocked-id-2');
            model.emailHash = 'hash2';
            model.blockedBy = 'admin-id-2';
            model.reason = 'Abusive behavior';
            model.createdAt = new Date('2025-01-02');
            return model;
          },
        },
      ];

      const findAllStub = sandbox.stub(BlockedReporterEntity, 'findAll').resolves(mockEntities as any);

      const result = await service.listBlockedReporters();

      sinon.assert.calledOnceWithExactly(findAllStub, {
        order: [['created_at', 'DESC']],
      });
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(BlockedReporter);
      expect(result[0].emailHash).toBe('hash1');
      expect(result[1].emailHash).toBe('hash2');
    });

    it('should return empty array when no reporters are blocked', async () => {
      sandbox.stub(BlockedReporterEntity, 'findAll').resolves([]);

      const result = await service.listBlockedReporters();

      expect(result).toEqual([]);
    });
  });

  describe('hashEmail', () => {
    it('should hash email using HMAC-SHA256', () => {
      const email = 'test@example.com';

      const hash1 = service.hashEmail(email);
      const hash2 = service.hashEmail(email);

      // Should be deterministic
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA256 produces 64 hex chars
    });

    it('should normalize email by trimming and lowercasing', () => {
      const hash1 = service.hashEmail('  Test@Example.COM  ');
      const hash2 = service.hashEmail('test@example.com');

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different emails', () => {
      const hash1 = service.hashEmail('user1@example.com');
      const hash2 = service.hashEmail('user2@example.com');

      expect(hash1).not.toBe(hash2);
    });
  });
});
