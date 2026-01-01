import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import request from 'supertest';
import express from 'express';

import { Account } from '@/common/model/account';
import { testApp } from '@/server/common/test/lib/express';
import AuthenticationRouteHandlers from '@/server/authentication/api/v1/auth';
import AccountInvitationRouteHandlers from '@/server/accounts/api/v1/invitations';
import AccountsInterface from '@/server/accounts/interface';
import AuthenticationInterface from '@/server/authentication/interface';

describe('Server-side Password Validation Integration', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('Password Reset Endpoint', () => {
    it('should reject passwords that are too short', async () => {
      // Create mock interfaces with sinon stubs
      const resetPasswordStub = sandbox.stub().resolves(new Account('id', 'test', 'test'));
      const mockAuthInterface = {
        resetPassword: resetPasswordStub,
        validatePasswordResetCode: sandbox.stub().resolves(true),
      } as unknown as AuthenticationInterface;

      const mockAccountsInterface = {
        isRegisteringAccount: sandbox.stub().resolves(false),
      } as unknown as AccountsInterface;

      const handlers = new AuthenticationRouteHandlers(mockAuthInterface, mockAccountsInterface);

      const router = express.Router();
      router.post('/reset-password/:code', handlers.setPassword.bind(handlers));

      const response = await request(testApp(router))
        .post('/reset-password/valid-code')
        .send({ password: 'short1!' });

      // Password validation should reject before service is called
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('password_too_short');
      // Service should NOT have been called since validation failed
      expect(resetPasswordStub.called).toBe(false);
    });

    it('should reject passwords lacking character variety', async () => {
      const resetPasswordStub = sandbox.stub().resolves(new Account('id', 'test', 'test'));
      const mockAuthInterface = {
        resetPassword: resetPasswordStub,
        validatePasswordResetCode: sandbox.stub().resolves(true),
      } as unknown as AuthenticationInterface;

      const mockAccountsInterface = {
        isRegisteringAccount: sandbox.stub().resolves(false),
      } as unknown as AccountsInterface;

      const handlers = new AuthenticationRouteHandlers(mockAuthInterface, mockAccountsInterface);

      const router = express.Router();
      router.post('/reset-password/:code', handlers.setPassword.bind(handlers));

      const response = await request(testApp(router))
        .post('/reset-password/valid-code')
        .send({ password: 'onlyletters' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('password_needs_variety');
      expect(resetPasswordStub.called).toBe(false);
    });
  });

  describe('Accept Invitation Endpoint', () => {
    it('should reject passwords that are too short', async () => {
      const acceptAccountInviteStub = sandbox.stub().resolves({
        account: new Account('id', 'test', 'test'),
        calendars: [],
      });
      const mockAccountsInterface = {
        acceptAccountInvite: acceptAccountInviteStub,
      } as unknown as AccountsInterface;

      const inviteHandlers = new AccountInvitationRouteHandlers(mockAccountsInterface);

      const router = express.Router();
      router.post('/invitations/:code', inviteHandlers.acceptInvite.bind(inviteHandlers));

      const response = await request(testApp(router))
        .post('/invitations/valid-code')
        .send({ password: 'short1!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('password_too_short');
      // Service should NOT have been called since validation failed
      expect(acceptAccountInviteStub.called).toBe(false);
    });

    it('should reject passwords lacking character variety', async () => {
      const acceptAccountInviteStub = sandbox.stub().resolves({
        account: new Account('id', 'test', 'test'),
        calendars: [],
      });
      const mockAccountsInterface = {
        acceptAccountInvite: acceptAccountInviteStub,
      } as unknown as AccountsInterface;

      const inviteHandlers = new AccountInvitationRouteHandlers(mockAccountsInterface);

      const router = express.Router();
      router.post('/invitations/:code', inviteHandlers.acceptInvite.bind(inviteHandlers));

      const response = await request(testApp(router))
        .post('/invitations/valid-code')
        .send({ password: '12345678' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('password_needs_variety');
      expect(acceptAccountInviteStub.called).toBe(false);
    });
  });
});
