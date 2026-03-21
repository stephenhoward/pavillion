import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Use vi.hoisted so mock variables are available when vi.mock factory runs
const { mockWarn, mockError } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockError: vi.fn(),
}));

vi.mock('@/server/common/helper/logger', () => ({
  default: { child: () => ({ warn: mockWarn, error: mockError }) },
  createLogger: () => ({ warn: mockWarn, error: mockError }),
}));

import { logActivityRejection, RejectionType, RejectionContext } from '@/server/activitypub/helper/rejection-logger';

describe('rejection-logger', () => {
  beforeEach(() => {
    mockWarn.mockClear();
    mockError.mockClear();
  });

  describe('logActivityRejection', () => {
    it('should call logger.warn with all required fields present', () => {
      const context: RejectionContext = {
        rejection_type: 'blocked_instance',
        activity_type: 'Create',
        actor_uri: 'https://remote.example.com/users/alice',
        actor_domain: 'remote.example.com',
        reason: 'Instance is blocked',
      };

      logActivityRejection(context);

      expect(mockWarn).toHaveBeenCalledOnce();
      const [logData, message] = mockWarn.mock.calls[0];

      expect(logData).toMatchObject({
        rejectionType: 'blocked_instance',
        activityType: 'Create',
        actorUri: 'https://remote.example.com/users/alice',
        actorDomain: 'remote.example.com',
      });
      expect(message).toContain('Instance is blocked');
    });

    it('should include optional fields when provided', () => {
      const context: RejectionContext = {
        rejection_type: 'unauthorized_editor',
        activity_type: 'Update',
        actor_uri: 'https://remote.example.com/users/bob',
        actor_domain: 'remote.example.com',
        calendar_id: 'calendar-uuid-123',
        calendar_url_name: 'mycalendar',
        reason: 'User is not an authorized editor',
        message_id: 'message-id-456',
        additional_context: {
          attempted_action: 'edit_event',
          event_id: 'event-789',
        },
      };

      logActivityRejection(context);

      expect(mockWarn).toHaveBeenCalledOnce();
      const [logData] = mockWarn.mock.calls[0];

      expect(logData.calendarId).toBe('calendar-uuid-123');
      expect(logData.calendarUrlName).toBe('mycalendar');
      expect(logData.messageId).toBe('message-id-456');
      expect(logData.additionalContext).toEqual({
        attempted_action: 'edit_event',
        event_id: 'event-789',
      });
    });

    it('should handle missing optional fields gracefully', () => {
      const context: RejectionContext = {
        rejection_type: 'invalid_object',
        activity_type: 'Delete',
        actor_uri: 'https://remote.example.com/users/charlie',
        actor_domain: 'remote.example.com',
        reason: 'Object format is invalid',
      };

      logActivityRejection(context);

      expect(mockWarn).toHaveBeenCalledOnce();
      const [logData] = mockWarn.mock.calls[0];

      expect(logData.calendarId).toBeUndefined();
      expect(logData.calendarUrlName).toBeUndefined();
      expect(logData.messageId).toBeUndefined();
      expect(logData.additionalContext).toBeUndefined();
    });

    describe('rejection types', () => {
      const warnRejectionTypes: RejectionType[] = [
        'blocked_instance',
        'unauthorized_editor',
        'ownership_verification_failed',
        'invalid_object',
      ];

      warnRejectionTypes.forEach((rejectionType) => {
        it(`should use logger.warn for ${rejectionType} rejection type`, () => {
          const context: RejectionContext = {
            rejection_type: rejectionType,
            activity_type: 'Create',
            actor_uri: 'https://remote.example.com/users/test',
            actor_domain: 'remote.example.com',
            reason: `Testing ${rejectionType}`,
          };

          logActivityRejection(context);

          expect(mockWarn).toHaveBeenCalledOnce();
          expect(mockError).not.toHaveBeenCalled();
          const [logData] = mockWarn.mock.calls[0];
          expect(logData.rejectionType).toBe(rejectionType);
        });
      });

      it('should use logger.error for parse_failure rejection type', () => {
        const context: RejectionContext = {
          rejection_type: 'parse_failure',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Testing parse_failure',
        };

        logActivityRejection(context);

        expect(mockError).toHaveBeenCalledOnce();
        expect(mockWarn).not.toHaveBeenCalled();
        const [logData] = mockError.mock.calls[0];
        expect(logData.rejectionType).toBe('parse_failure');
      });
    });

    describe('log levels', () => {
      it('should use logger.warn for blocked_instance', () => {
        const context: RejectionContext = {
          rejection_type: 'blocked_instance',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(mockWarn).toHaveBeenCalledOnce();
        expect(mockError).not.toHaveBeenCalled();
      });

      it('should use logger.warn for unauthorized_editor', () => {
        const context: RejectionContext = {
          rejection_type: 'unauthorized_editor',
          activity_type: 'Update',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(mockWarn).toHaveBeenCalledOnce();
        expect(mockError).not.toHaveBeenCalled();
      });

      it('should use logger.warn for ownership_verification_failed', () => {
        const context: RejectionContext = {
          rejection_type: 'ownership_verification_failed',
          activity_type: 'Delete',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(mockWarn).toHaveBeenCalledOnce();
        expect(mockError).not.toHaveBeenCalled();
      });

      it('should use logger.error for parse_failure', () => {
        const context: RejectionContext = {
          rejection_type: 'parse_failure',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(mockError).toHaveBeenCalledOnce();
        expect(mockWarn).not.toHaveBeenCalled();
      });

      it('should use logger.warn for invalid_object', () => {
        const context: RejectionContext = {
          rejection_type: 'invalid_object',
          activity_type: 'Update',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(mockWarn).toHaveBeenCalledOnce();
        expect(mockError).not.toHaveBeenCalled();
      });
    });

    describe('data passed to logger', () => {
      it('should pass rejection context data to logger for blocked_instance', () => {
        const context: RejectionContext = {
          rejection_type: 'blocked_instance',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test consistency',
          calendar_id: 'cal-123',
        };

        logActivityRejection(context);

        const [logData, message] = mockWarn.mock.calls[0];
        expect(logData.rejectionType).toBe('blocked_instance');
        expect(logData.activityType).toBe('Create');
        expect(logData.actorUri).toBe('https://remote.example.com/users/test');
        expect(logData.actorDomain).toBe('remote.example.com');
        expect(logData.calendarId).toBe('cal-123');
        expect(message).toContain('Test consistency');
      });

      it('should pass data consistently for multiple calls', () => {
        const context1: RejectionContext = {
          rejection_type: 'blocked_instance',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test1',
          actor_domain: 'remote.example.com',
          reason: 'Test 1',
          calendar_id: 'cal-123',
        };

        const context2: RejectionContext = {
          rejection_type: 'unauthorized_editor',
          activity_type: 'Update',
          actor_uri: 'https://remote.example.com/users/test2',
          actor_domain: 'remote.example.com',
          reason: 'Test 2',
          calendar_id: 'cal-456',
        };

        logActivityRejection(context1);
        logActivityRejection(context2);

        expect(mockWarn).toHaveBeenCalledTimes(2);
        const [logData1] = mockWarn.mock.calls[0];
        const [logData2] = mockWarn.mock.calls[1];

        expect(logData1.rejectionType).toBe('blocked_instance');
        expect(logData2.rejectionType).toBe('unauthorized_editor');
      });
    });

    describe('edge cases', () => {
      it('should handle complex additional_context objects', () => {
        const context: RejectionContext = {
          rejection_type: 'invalid_object',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Complex context test',
          additional_context: {
            nested: {
              deeply: {
                nested: {
                  value: 'test',
                },
              },
            },
            array: [1, 2, 3],
            boolean: true,
            null_value: null,
          },
        };

        logActivityRejection(context);

        const [logData] = mockWarn.mock.calls[0];
        expect(logData.additionalContext).toEqual({
          nested: {
            deeply: {
              nested: {
                value: 'test',
              },
            },
          },
          array: [1, 2, 3],
          boolean: true,
          null_value: null,
        });
      });

      it('should handle special characters in string fields', () => {
        const context: RejectionContext = {
          rejection_type: 'blocked_instance',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test"quote',
          actor_domain: 'remote.example.com',
          reason: 'Test with "quotes" and \n newlines and \t tabs',
        };

        logActivityRejection(context);

        const [logData, message] = mockWarn.mock.calls[0];
        expect(logData.actorUri).toBe('https://remote.example.com/users/test"quote');
        expect(message).toContain('Test with "quotes"');
      });

      it('should handle empty strings in required fields', () => {
        const context: RejectionContext = {
          rejection_type: 'invalid_object',
          activity_type: '',
          actor_uri: '',
          actor_domain: '',
          reason: '',
        };

        logActivityRejection(context);

        const [logData] = mockWarn.mock.calls[0];
        expect(logData.activityType).toBe('');
        expect(logData.actorUri).toBe('');
        expect(logData.actorDomain).toBe('');
      });
    });
  });
});
