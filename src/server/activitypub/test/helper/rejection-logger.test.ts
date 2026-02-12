import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import { logActivityRejection, RejectionType, RejectionContext } from '@/server/activitypub/helper/rejection-logger';

describe('rejection-logger', () => {
  let sandbox: sinon.SinonSandbox;
  let consoleWarnStub: sinon.SinonStub;
  let consoleErrorStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    consoleWarnStub = sandbox.stub(console, 'warn');
    consoleErrorStub = sandbox.stub(console, 'error');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('logActivityRejection', () => {
    it('should log with all required fields present', () => {
      const context: RejectionContext = {
        rejection_type: 'blocked_instance',
        activity_type: 'Create',
        actor_uri: 'https://remote.example.com/users/alice',
        actor_domain: 'remote.example.com',
        reason: 'Instance is blocked',
      };

      logActivityRejection(context);

      expect(consoleWarnStub.calledOnce).toBe(true);
      const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);

      expect(logEntry).toHaveProperty('timestamp');
      expect(logEntry).toHaveProperty('level', 'warn');
      expect(logEntry).toHaveProperty('context', 'activitypub.inbox.rejection');
      expect(logEntry).toHaveProperty('rejection_type', 'blocked_instance');
      expect(logEntry).toHaveProperty('activity_type', 'Create');
      expect(logEntry).toHaveProperty('actor_uri', 'https://remote.example.com/users/alice');
      expect(logEntry).toHaveProperty('actor_domain', 'remote.example.com');
      expect(logEntry).toHaveProperty('reason', 'Instance is blocked');
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

      expect(consoleWarnStub.calledOnce).toBe(true);
      const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);

      expect(logEntry.calendar_id).toBe('calendar-uuid-123');
      expect(logEntry.calendar_url_name).toBe('mycalendar');
      expect(logEntry.message_id).toBe('message-id-456');
      expect(logEntry.additional_context).toEqual({
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

      expect(consoleWarnStub.calledOnce).toBe(true);
      const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);

      expect(logEntry.calendar_id).toBeUndefined();
      expect(logEntry.calendar_url_name).toBeUndefined();
      expect(logEntry.message_id).toBeUndefined();
      expect(logEntry.additional_context).toBeUndefined();
    });

    it('should output valid ISO 8601 timestamp', () => {
      const context: RejectionContext = {
        rejection_type: 'blocked_instance',
        activity_type: 'Create',
        actor_uri: 'https://remote.example.com/users/dave',
        actor_domain: 'remote.example.com',
        reason: 'Test timestamp',
      };

      logActivityRejection(context);

      const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);
      const timestamp = logEntry.timestamp;

      // Validate ISO 8601 format
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(timestamp).toISOString()).toBe(timestamp);
    });

    describe('rejection types', () => {
      const rejectionTypes: RejectionType[] = [
        'blocked_instance',
        'unauthorized_editor',
        'ownership_verification_failed',
        'parse_failure',
        'invalid_object',
      ];

      rejectionTypes.forEach((rejectionType) => {
        it(`should log ${rejectionType} rejection type correctly`, () => {
          const context: RejectionContext = {
            rejection_type: rejectionType,
            activity_type: 'Create',
            actor_uri: 'https://remote.example.com/users/test',
            actor_domain: 'remote.example.com',
            reason: `Testing ${rejectionType}`,
          };

          logActivityRejection(context);

          const logStub = rejectionType === 'parse_failure' ? consoleErrorStub : consoleWarnStub;
          expect(logStub.calledOnce).toBe(true);
          const logEntry = JSON.parse(logStub.firstCall.args[0]);

          expect(logEntry.rejection_type).toBe(rejectionType);
        });
      });
    });

    describe('log levels', () => {
      it('should use warn level for blocked_instance', () => {
        const context: RejectionContext = {
          rejection_type: 'blocked_instance',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(consoleWarnStub.calledOnce).toBe(true);
        expect(consoleErrorStub.called).toBe(false);
        const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);
        expect(logEntry.level).toBe('warn');
      });

      it('should use warn level for unauthorized_editor', () => {
        const context: RejectionContext = {
          rejection_type: 'unauthorized_editor',
          activity_type: 'Update',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(consoleWarnStub.calledOnce).toBe(true);
        expect(consoleErrorStub.called).toBe(false);
        const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);
        expect(logEntry.level).toBe('warn');
      });

      it('should use warn level for ownership_verification_failed', () => {
        const context: RejectionContext = {
          rejection_type: 'ownership_verification_failed',
          activity_type: 'Delete',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(consoleWarnStub.calledOnce).toBe(true);
        expect(consoleErrorStub.called).toBe(false);
        const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);
        expect(logEntry.level).toBe('warn');
      });

      it('should use error level for parse_failure', () => {
        const context: RejectionContext = {
          rejection_type: 'parse_failure',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(consoleErrorStub.calledOnce).toBe(true);
        expect(consoleWarnStub.called).toBe(false);
        const logEntry = JSON.parse(consoleErrorStub.firstCall.args[0]);
        expect(logEntry.level).toBe('error');
      });

      it('should use warn level for invalid_object', () => {
        const context: RejectionContext = {
          rejection_type: 'invalid_object',
          activity_type: 'Update',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        expect(consoleWarnStub.calledOnce).toBe(true);
        expect(consoleErrorStub.called).toBe(false);
        const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);
        expect(logEntry.level).toBe('warn');
      });
    });

    describe('log format consistency', () => {
      it('should output well-formed JSON with consistent structure', () => {
        const context: RejectionContext = {
          rejection_type: 'blocked_instance',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test consistency',
        };

        logActivityRejection(context);

        const logString = consoleWarnStub.firstCall.args[0];

        // Should be valid JSON
        expect(() => JSON.parse(logString)).not.toThrow();

        // Should be pretty-printed (with indentation)
        expect(logString).toContain('\n');
        expect(logString).toContain('  ');
      });

      it('should maintain consistent structure for same rejection scenario', () => {
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

        const log1 = JSON.parse(consoleWarnStub.firstCall.args[0]);
        const log2 = JSON.parse(consoleWarnStub.secondCall.args[0]);

        // Both should have the same field structure when same fields provided
        const keys1 = Object.keys(log1);
        const keys2 = Object.keys(log2);

        expect(keys1).toEqual(keys2);

        // Core structure fields should be present in same order
        expect(keys1.slice(0, 5)).toEqual([
          'timestamp',
          'level',
          'context',
          'rejection_type',
          'activity_type',
        ]);
      });

      it('should always include core structure fields in consistent order', () => {
        const contexts: RejectionContext[] = [
          {
            rejection_type: 'blocked_instance',
            activity_type: 'Create',
            actor_uri: 'https://remote.example.com/users/test',
            actor_domain: 'remote.example.com',
            reason: 'Test',
          },
          {
            rejection_type: 'parse_failure',
            activity_type: 'Update',
            actor_uri: 'https://remote.example.com/users/test',
            actor_domain: 'remote.example.com',
            reason: 'Test',
          },
        ];

        contexts.forEach((context) => {
          logActivityRejection(context);
        });

        const log1 = JSON.parse(consoleWarnStub.firstCall.args[0]);
        const log2 = JSON.parse(consoleErrorStub.firstCall.args[0]);

        // Core fields should appear first in same order
        const coreFields = ['timestamp', 'level', 'context', 'rejection_type', 'activity_type'];
        const keys1 = Object.keys(log1);
        const keys2 = Object.keys(log2);

        coreFields.forEach((field, index) => {
          expect(keys1[index]).toBe(field);
          expect(keys2[index]).toBe(field);
        });
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

        const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);
        expect(logEntry.additional_context).toEqual({
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

        const logString = consoleWarnStub.firstCall.args[0];
        const logEntry = JSON.parse(logString);

        expect(logEntry.actor_uri).toBe('https://remote.example.com/users/test"quote');
        expect(logEntry.reason).toBe('Test with "quotes" and \n newlines and \t tabs');
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

        const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);

        expect(logEntry.activity_type).toBe('');
        expect(logEntry.actor_uri).toBe('');
        expect(logEntry.actor_domain).toBe('');
        expect(logEntry.reason).toBe('');
      });
    });

    describe('context field', () => {
      it('should always include fixed context value', () => {
        const context: RejectionContext = {
          rejection_type: 'blocked_instance',
          activity_type: 'Create',
          actor_uri: 'https://remote.example.com/users/test',
          actor_domain: 'remote.example.com',
          reason: 'Test',
        };

        logActivityRejection(context);

        const logEntry = JSON.parse(consoleWarnStub.firstCall.args[0]);
        expect(logEntry.context).toBe('activitypub.inbox.rejection');
      });
    });
  });
});
