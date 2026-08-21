import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { ReportEntity } from '@/server/moderation/entity/report';
import { ReportCategory, ReportStatus } from '@/common/model/report';
import AccountService from '@/server/accounts/service/account';
import AccountsInterface from '@/server/accounts/interface';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';
import SetupInterface from '@/server/setup/interface';
import { TestEnvironment } from '@/server/common/test/lib/test_environment';

/**
 * Integration tests for the `source=federation` filter on both report
 * queues. `reporterType: 'federation'` is written by receiveRemoteReport
 * for inbound federated Flag activities, so both queues must accept it
 * as a filter value rather than rejecting it with a 400.
 *
 * Verifies:
 *   - The calendar-owner queue returns federated reports for
 *     ?source=federation regardless of status (owner-first routing:
 *     the owner always sees them).
 *   - The admin queue accepts ?source=federation but returns only
 *     ESCALATED federated reports — unescalated ones stay owner-only
 *     per DEC-015's escalated-OR-admin-initiated base condition.
 *   - Invalid source values still return 400 on both queues.
 */
describe('Report queues - source=federation filter (integration)', () => {
  let env: TestEnvironment;
  let authToken: string;
  let ownerAccount: Account;
  let testCalendar: Calendar;

  const ownerEmail = 'fed-source-filter@pavillion.dev';
  const password = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init();

    const eventBus = new EventEmitter();
    const configurationInterface = new ConfigurationInterface();
    const setupInterface = new SetupInterface();
    const accountsInterface = new AccountsInterface(eventBus, configurationInterface, setupInterface);
    const calendarInterface = new CalendarInterface(eventBus, accountsInterface, configurationInterface);
    const accountService = new AccountService(eventBus, configurationInterface, setupInterface);

    // _setupAccount grants admin role in test mode, so one account can
    // exercise both the owner queue (as calendar owner) and the admin queue.
    const ownerInfo = await accountService._setupAccount(ownerEmail, password);
    ownerAccount = ownerInfo.account;
    testCalendar = await calendarInterface.createCalendar(ownerAccount, 'fedsourcefilter');

    authToken = await env.login(ownerEmail, password);
  });

  afterAll(async () => {
    await env.cleanup();
  });

  afterEach(async () => {
    await ReportEntity.destroy({ where: {} });
  });

  /**
   * Seeds a federated report (the row shape receiveRemoteReport writes)
   * on the test calendar with the given status.
   */
  async function seedFederationReport(status: ReportStatus, description: string): Promise<string> {
    const id = uuidv4();
    await ReportEntity.create({
      id,
      event_id: uuidv4(),
      calendar_id: testCalendar.id,
      category: ReportCategory.SPAM,
      description,
      reporter_type: 'federation',
      forwarded_from_instance: 'remote.instance.example',
      forwarded_report_id: uuidv4(),
      status,
      escalation_type: status === ReportStatus.ESCALATED ? 'automatic' : null,
    });
    return id;
  }

  /**
   * Seeds a non-federated (anonymous) report on the test calendar.
   */
  async function seedAnonymousReport(status: ReportStatus, description: string): Promise<string> {
    const id = uuidv4();
    await ReportEntity.create({
      id,
      event_id: uuidv4(),
      calendar_id: testCalendar.id,
      category: ReportCategory.SPAM,
      description,
      reporter_type: 'anonymous',
      status,
    });
    return id;
  }

  describe('calendar-owner queue', () => {
    it('returns federated reports for ?source=federation instead of 400', async () => {
      const submittedId = await seedFederationReport(ReportStatus.SUBMITTED, 'Federated submitted');
      const escalatedId = await seedFederationReport(ReportStatus.ESCALATED, 'Federated escalated');
      await seedAnonymousReport(ReportStatus.SUBMITTED, 'Local anonymous');

      const response = await env.authGet(
        authToken,
        `/api/v1/calendars/${testCalendar.id}/reports?source=federation`,
      );

      expect(response.status).toBe(200);
      expect(response.body.reports).toHaveLength(2);

      const returnedIds = response.body.reports.map((r: any) => r.id);
      expect(returnedIds).toContain(submittedId);
      expect(returnedIds).toContain(escalatedId);

      for (const report of response.body.reports) {
        expect(report.reporterType).toBe('federation');
      }
    });

    it('still returns 400 for an invalid source value', async () => {
      const response = await env.authGet(
        authToken,
        `/api/v1/calendars/${testCalendar.id}/reports?source=invalid_source`,
      );

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ReportValidationError');
    });
  });

  describe('admin queue', () => {
    it('returns only escalated federated reports for ?source=federation', async () => {
      // DEC-015: an unescalated federated report is owner-only; the admin
      // queue's escalated-OR-admin-initiated base condition stands, and
      // source=federation filters within that set.
      await seedFederationReport(ReportStatus.SUBMITTED, 'Federated submitted, owner-only');
      const escalatedId = await seedFederationReport(ReportStatus.ESCALATED, 'Federated escalated');
      await seedAnonymousReport(ReportStatus.ESCALATED, 'Local anonymous escalated');

      const response = await env.authGet(authToken, '/api/v1/admin/reports?source=federation');

      expect(response.status).toBe(200);
      expect(response.body.reports).toHaveLength(1);
      expect(response.body.reports[0].id).toBe(escalatedId);
      expect(response.body.reports[0].reporterType).toBe('federation');
      expect(response.body.reports[0].status).toBe(ReportStatus.ESCALATED);
    });

    it('still returns 400 for an invalid source value', async () => {
      const response = await env.authGet(authToken, '/api/v1/admin/reports?source=invalid_source');

      expect(response.status).toBe(400);
      expect(response.body.errorName).toBe('ReportValidationError');
    });
  });
});
