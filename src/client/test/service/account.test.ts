import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import AccountService from '@/client/service/account';
import { Account } from '@/common/model/account';
import { UnauthenticatedError, UnknownError } from '@/common/exceptions';

describe('AccountService', () => {
  let service: AccountService;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    service = new AccountService();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('getProfile', () => {
    it('should fetch current user profile', async () => {
      const mockProfile = {
        id: '123',
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        roles: ['user'],
      };

      const axiosGetStub = sandbox.stub(axios, 'get').resolves({ data: mockProfile });

      const result = await service.getProfile();

      expect(axiosGetStub.calledOnce).toBe(true);
      expect(axiosGetStub.calledWith('/api/v1/accounts/me')).toBe(true);
      expect(result).toBeInstanceOf(Account);
      expect(result.id).toBe('123');
      expect(result.email).toBe('test@example.com');
      expect(result.displayName).toBe('Test User');
    });

    it('should throw UnknownError when fetching profile fails', async () => {
      sandbox.stub(axios, 'get').rejects(new Error('API Error'));

      await expect(service.getProfile()).rejects.toThrow(UnknownError);
    });

    it('should handle UnauthenticatedError from API', async () => {
      sandbox.stub(axios, 'get').rejects({
        response: {
          data: { errorName: 'UnauthenticatedError' },
        },
      });

      await expect(service.getProfile()).rejects.toThrow(UnauthenticatedError);
    });
  });

  describe('updateProfile', () => {
    it('should update user display name', async () => {
      const mockUpdatedProfile = {
        id: '123',
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Updated Name',
        roles: ['user'],
      };

      const axiosPatchStub = sandbox.stub(axios, 'patch').resolves({ data: mockUpdatedProfile });

      const result = await service.updateProfile('Updated Name');

      expect(axiosPatchStub.calledOnce).toBe(true);
      expect(axiosPatchStub.calledWith('/api/v1/accounts/me/profile', {
        displayName: 'Updated Name',
      })).toBe(true);
      expect(result).toBeInstanceOf(Account);
      expect(result.displayName).toBe('Updated Name');
    });

    it('should handle empty display name', async () => {
      const mockUpdatedProfile = {
        id: '123',
        username: 'testuser',
        email: 'test@example.com',
        displayName: '',
        roles: ['user'],
      };

      const axiosPatchStub = sandbox.stub(axios, 'patch').resolves({ data: mockUpdatedProfile });

      const result = await service.updateProfile('');

      expect(axiosPatchStub.calledOnce).toBe(true);
      expect(result.displayName).toBe('');
    });

    it('should throw UnknownError when updating profile fails', async () => {
      sandbox.stub(axios, 'patch').rejects(new Error('API Error'));

      await expect(service.updateProfile('New Name')).rejects.toThrow(UnknownError);
    });

    it('should handle UnauthenticatedError from API', async () => {
      sandbox.stub(axios, 'patch').rejects({
        response: {
          data: { errorName: 'UnauthenticatedError' },
        },
      });

      await expect(service.updateProfile('New Name')).rejects.toThrow(UnauthenticatedError);
    });
  });
});
