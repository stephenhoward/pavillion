import { describe, it, expect } from 'vitest';
import {
  InvalidRemoteCalendarIdentifierError,
  InvalidRepostPolicyError,
  InvalidSharedEventUrlError,
  FollowRelationshipNotFoundError,
  RemoteCalendarNotFoundError,
  RemoteDomainUnreachableError,
  ActivityPubNotSupportedError,
  RemoteProfileFetchError,
  SelfFollowError,
} from '@/common/exceptions/activitypub';

describe('ActivityPub Exceptions', () => {
  describe('Exception class instantiation', () => {
    it('should create InvalidRemoteCalendarIdentifierError that extends Error', () => {
      const error = new InvalidRemoteCalendarIdentifierError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidRemoteCalendarIdentifierError);
    });

    it('should create InvalidRepostPolicyError that extends Error', () => {
      const error = new InvalidRepostPolicyError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidRepostPolicyError);
    });

    it('should create InvalidSharedEventUrlError that extends Error', () => {
      const error = new InvalidSharedEventUrlError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(InvalidSharedEventUrlError);
    });

    it('should create FollowRelationshipNotFoundError that extends Error', () => {
      const error = new FollowRelationshipNotFoundError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(FollowRelationshipNotFoundError);
    });

    it('should create RemoteCalendarNotFoundError that extends Error', () => {
      const error = new RemoteCalendarNotFoundError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RemoteCalendarNotFoundError);
    });

    it('should create RemoteDomainUnreachableError that extends Error', () => {
      const error = new RemoteDomainUnreachableError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RemoteDomainUnreachableError);
    });

    it('should create ActivityPubNotSupportedError that extends Error', () => {
      const error = new ActivityPubNotSupportedError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ActivityPubNotSupportedError);
    });

    it('should create RemoteProfileFetchError that extends Error', () => {
      const error = new RemoteProfileFetchError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RemoteProfileFetchError);
    });

    it('should create SelfFollowError that extends Error', () => {
      const error = new SelfFollowError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(SelfFollowError);
    });
  });

  describe('Default error messages', () => {
    it('should have default message for InvalidRemoteCalendarIdentifierError', () => {
      const error = new InvalidRemoteCalendarIdentifierError();
      expect(error.message).toBe('Invalid remote calendar identifier format. Expected username@domain');
    });

    it('should have default message for InvalidRepostPolicyError', () => {
      const error = new InvalidRepostPolicyError();
      expect(error.message).toBe('Invalid auto-repost policy value');
    });

    it('should have default message for InvalidSharedEventUrlError', () => {
      const error = new InvalidSharedEventUrlError();
      expect(error.message).toBe('Invalid event URL for sharing');
    });

    it('should have default message for FollowRelationshipNotFoundError', () => {
      const error = new FollowRelationshipNotFoundError();
      expect(error.message).toBe('Follow relationship not found');
    });

    it('should have default message for RemoteCalendarNotFoundError', () => {
      const error = new RemoteCalendarNotFoundError();
      expect(error.message).toBe('Remote calendar not found');
    });

    it('should have default message for RemoteDomainUnreachableError', () => {
      const error = new RemoteDomainUnreachableError();
      expect(error.message).toBe('Cannot connect to remote domain');
    });

    it('should have default message for ActivityPubNotSupportedError', () => {
      const error = new ActivityPubNotSupportedError();
      expect(error.message).toBe('Remote server does not support ActivityPub');
    });

    it('should have default message for RemoteProfileFetchError', () => {
      const error = new RemoteProfileFetchError();
      expect(error.message).toBe('Failed to fetch remote actor profile');
    });

    it('should have default message for SelfFollowError', () => {
      const error = new SelfFollowError();
      expect(error.message).toBe('Calendar cannot follow itself');
    });
  });

  describe('Custom error messages', () => {
    it('should allow custom message for InvalidRemoteCalendarIdentifierError', () => {
      const customMessage = 'The identifier "invalid" is not valid';
      const error = new InvalidRemoteCalendarIdentifierError(customMessage);
      expect(error.message).toBe(customMessage);
    });

    it('should allow custom message for InvalidRepostPolicyError', () => {
      const customMessage = 'Policy must be "always", "trusted", or "never"';
      const error = new InvalidRepostPolicyError(customMessage);
      expect(error.message).toBe(customMessage);
    });

    it('should allow custom message for RemoteCalendarNotFoundError', () => {
      const customMessage = 'Calendar user@example.com not found';
      const error = new RemoteCalendarNotFoundError(customMessage);
      expect(error.message).toBe(customMessage);
    });

    it('should allow custom message for RemoteDomainUnreachableError', () => {
      const customMessage = 'Cannot reach example.com: ENOTFOUND';
      const error = new RemoteDomainUnreachableError(customMessage);
      expect(error.message).toBe(customMessage);
    });
  });

  describe('instanceof checks for exception hierarchy', () => {
    it('should support instanceof for InvalidRemoteCalendarIdentifierError', () => {
      const error = new InvalidRemoteCalendarIdentifierError();
      expect(error instanceof Error).toBe(true);
      expect(error instanceof InvalidRemoteCalendarIdentifierError).toBe(true);
    });

    it('should support instanceof for RemoteDomainUnreachableError', () => {
      const error = new RemoteDomainUnreachableError('test');
      expect(error instanceof Error).toBe(true);
      expect(error instanceof RemoteDomainUnreachableError).toBe(true);
    });

    it('should support instanceof for SelfFollowError', () => {
      const error = new SelfFollowError();
      expect(error instanceof Error).toBe(true);
      expect(error instanceof SelfFollowError).toBe(true);
    });

    it('should correctly differentiate between different exception types', () => {
      const validationError = new InvalidRepostPolicyError();
      const notFoundError = new RemoteCalendarNotFoundError();

      expect(validationError instanceof InvalidRepostPolicyError).toBe(true);
      expect(validationError instanceof RemoteCalendarNotFoundError).toBe(false);

      expect(notFoundError instanceof RemoteCalendarNotFoundError).toBe(true);
      expect(notFoundError instanceof InvalidRepostPolicyError).toBe(false);
    });
  });
});
