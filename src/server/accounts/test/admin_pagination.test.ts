import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';
import { EventEmitter } from 'events';
import AdminAccountRouteHandlers from '../api/v1/admin';
import AccountsInterface from '../interface';
import { Account } from '../../../common/model/account';
import AccountInvitation from '../../../common/model/invitation';
import AccountApplication from '../../../common/model/application';
import { testApp } from '../../common/test/lib/express';
import ConfigurationInterface from '../../configuration/interface';
import SetupInterface from '../../setup/interface';

/**
 * Tests for pagination limits on admin endpoints to prevent DoS attacks
 */
describe('Admin API Pagination Limits', () => {
  let sandbox: sinon.SinonSandbox = sinon.createSandbox();
  let router: express.Router;
  let accountsInterface: AccountsInterface;
  let adminHandlers: AdminAccountRouteHandlers;
  let mockAccount: Account;

  beforeEach(() => {
    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    adminHandlers = new AdminAccountRouteHandlers(accountsInterface);
    router = express.Router();

    // Create mock admin account
    mockAccount = new Account('admin-id', 'admin@test.com', 'admin');
    mockAccount.roles = ['admin'];

    // Mock authentication
    router.use((req, res, next) => {
      req.user = mockAccount;
      next();
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /admin/applications', () => {
    it('should enforce maximum limit of 100 items', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listAccountApplications');

      // Mock response with pagination metadata
      listStub.resolves({
        applications: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 100,
        },
      });

      router.get('/admin/applications', adminHandlers.listApplications.bind(adminHandlers));

      // Request with limit > 100 should be clamped to 100
      await request(testApp(router))
        .get('/admin/applications?limit=500');

      // Verify service was called with enforced limit of 100
      expect(listStub.calledOnce).toBe(true);
      const [page, limit] = listStub.firstCall.args;
      expect(limit).toBe(100);
    });

    it('should use default limit of 50 when no limit specified', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listAccountApplications');

      listStub.resolves({
        applications: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 50,
        },
      });

      router.get('/admin/applications', adminHandlers.listApplications.bind(adminHandlers));

      await request(testApp(router))
        .get('/admin/applications');

      expect(listStub.calledOnce).toBe(true);
      const [page, limit] = listStub.firstCall.args;
      expect(limit).toBe(50);
    });

    it('should accept custom limit within range', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listAccountApplications');

      listStub.resolves({
        applications: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 25,
        },
      });

      router.get('/admin/applications', adminHandlers.listApplications.bind(adminHandlers));

      await request(testApp(router))
        .get('/admin/applications?limit=25');

      expect(listStub.calledOnce).toBe(true);
      const [page, limit] = listStub.firstCall.args;
      expect(limit).toBe(25);
    });

    it('should return pagination metadata in response', async () => {
      // Create mock applications as plain objects (AccountApplication doesn't have toObject)
      const mockApplications = [
        new AccountApplication('app-1', 'user1@test.com', 'pending'),
        new AccountApplication('app-2', 'user2@test.com', 'pending'),
      ];

      const listStub = sandbox.stub(accountsInterface, 'listAccountApplications');
      listStub.resolves({
        applications: mockApplications,
        pagination: {
          currentPage: 1,
          totalPages: 5,
          totalCount: 250,
          limit: 50,
        },
      });

      router.get('/admin/applications', adminHandlers.listApplications.bind(adminHandlers));

      const response = await request(testApp(router))
        .get('/admin/applications');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('applications');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination.currentPage).toBe(1);
      expect(response.body.pagination.totalPages).toBe(5);
      expect(response.body.pagination.totalCount).toBe(250);
      expect(response.body.pagination.limit).toBe(50);
      expect(response.body.applications).toHaveLength(2);
    });
  });

  describe('GET /admin/invitations', () => {
    it('should enforce maximum limit of 100 items', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listInvitations');

      listStub.resolves({
        invitations: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 100,
        },
      });

      router.get('/admin/invitations', adminHandlers.listInvitations.bind(adminHandlers));

      // Request with limit > 100 should be clamped to 100
      await request(testApp(router))
        .get('/admin/invitations?limit=1000');

      expect(listStub.calledOnce).toBe(true);
      const [page, limit] = listStub.firstCall.args;
      expect(limit).toBe(100);
    });

    it('should use default limit of 50 when no limit specified', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listInvitations');

      listStub.resolves({
        invitations: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 50,
        },
      });

      router.get('/admin/invitations', adminHandlers.listInvitations.bind(adminHandlers));

      await request(testApp(router))
        .get('/admin/invitations');

      expect(listStub.calledOnce).toBe(true);
      const [page, limit] = listStub.firstCall.args;
      expect(limit).toBe(50);
    });

    it('should return pagination metadata in response', async () => {
      const mockInviter = new Account('admin-id', 'admin@test.com', 'admin');
      const mockInvitations = [
        new AccountInvitation('inv-1', 'user1@test.com', mockInviter),
        new AccountInvitation('inv-2', 'user2@test.com', mockInviter),
      ];

      const listStub = sandbox.stub(accountsInterface, 'listInvitations');
      listStub.resolves({
        invitations: mockInvitations,
        pagination: {
          currentPage: 2,
          totalPages: 10,
          totalCount: 500,
          limit: 50,
        },
      });

      router.get('/admin/invitations', adminHandlers.listInvitations.bind(adminHandlers));

      const response = await request(testApp(router))
        .get('/admin/invitations?page=2');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('invitations');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.pagination.currentPage).toBe(2);
      expect(response.body.pagination.totalPages).toBe(10);
      expect(response.body.pagination.totalCount).toBe(500);
      expect(response.body.pagination.limit).toBe(50);
    });
  });

  describe('Pagination Enforcement Logic', () => {
    it('should verify service is called with enforced limit for applications', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listAccountApplications');
      listStub.resolves({
        applications: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 100,
        },
      });

      router.get('/admin/applications', adminHandlers.listApplications.bind(adminHandlers));

      // Request with excessive limit
      await request(testApp(router))
        .get('/admin/applications?limit=999999');

      // Verify API handler clamped the limit
      const [page, limit] = listStub.firstCall.args;
      expect(limit).toBeLessThanOrEqual(100);
    });

    it('should verify service is called with enforced limit for invitations', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listInvitations');
      listStub.resolves({
        invitations: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 100,
        },
      });

      router.get('/admin/invitations', adminHandlers.listInvitations.bind(adminHandlers));

      // Request with excessive limit
      await request(testApp(router))
        .get('/admin/invitations?limit=999999');

      // Verify API handler clamped the limit
      const [page, limit] = listStub.firstCall.args;
      expect(limit).toBeLessThanOrEqual(100);
    });

    it('should handle negative page numbers in request', async () => {
      const listStub = sandbox.stub(accountsInterface, 'listAccountApplications');
      listStub.resolves({
        applications: [],
        pagination: {
          currentPage: 1,
          totalPages: 1,
          totalCount: 0,
          limit: 50,
        },
      });

      router.get('/admin/applications', adminHandlers.listApplications.bind(adminHandlers));

      await request(testApp(router))
        .get('/admin/applications?page=-5');

      // Should default to page 1
      const [page] = listStub.firstCall.args;
      expect(page).toBe(1);
    });
  });
});
