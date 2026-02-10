import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import i18next from 'i18next';
import AdminReportNotificationEmail from '../../model/admin_report_notification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Tests for AdminReportNotificationEmail model.
 *
 * Verifies that the email model correctly builds messages
 * with priority indicator in subject, deadline display,
 * and link to review dashboard.
 */
describe('AdminReportNotificationEmail', () => {
  let sandbox: sinon.SinonSandbox;
  let i18nextTStub: sinon.SinonStub;
  let i18nextHasResourceBundleStub: sinon.SinonStub;
  let i18nextSetDefaultNamespaceStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    i18nextTStub = sandbox.stub();
    i18nextHasResourceBundleStub = sandbox.stub();
    i18nextSetDefaultNamespaceStub = sandbox.stub();

    Object.defineProperty(i18next, 't', { value: i18nextTStub, configurable: true });
    Object.defineProperty(i18next, 'hasResourceBundle', { value: i18nextHasResourceBundleStub, configurable: true });
    Object.defineProperty(i18next, 'setDefaultNamespace', { value: i18nextSetDefaultNamespaceStub, configurable: true });

    i18nextTStub.returns('Translated Subject');
    i18nextHasResourceBundleStub.returns(true);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should construct with the correct namespace', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'This event is spam',
      'high',
      '2026-02-14',
      'calendar-uuid',
    );

    expect(email.namespace).toBe('admin_report_notification_email');
  });

  it('should store constructor parameters correctly', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Community Meetup',
      'City Calendar',
      'inappropriate',
      'Contains inappropriate content',
      'medium',
      '2026-03-01',
      'cal-123',
    );

    expect(email.recipientEmail).toBe('owner@example.com');
    expect(email.eventName).toBe('Community Meetup');
    expect(email.calendarName).toBe('City Calendar');
    expect(email.reportCategory).toBe('inappropriate');
    expect(email.reportDescription).toBe('Contains inappropriate content');
    expect(email.priority).toBe('medium');
    expect(email.deadline).toBe('2026-03-01');
    expect(email.calendarId).toBe('cal-123');
  });

  it('should set the correct email address in buildMessage', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.emailAddress).toBe('owner@example.com');
  });

  it('should include priority indicator in subject line', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.subject).toContain('[HIGH]');
  });

  it('should include medium priority indicator in subject line', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'medium',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.subject).toContain('[MEDIUM]');
  });

  it('should render the subject via i18n with priority prefix', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'low',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(i18nextSetDefaultNamespaceStub.calledWith('admin_report_notification_email')).toBe(true);
    expect(mailData.subject).toBe('[LOW] Translated Subject');
  });

  it('should include text and html messages', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      '2026-02-14',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toBeDefined();
    expect(mailData.textMessage.length).toBeGreaterThan(0);
    expect(mailData.htmlMessage).toBeDefined();
    expect(mailData.htmlMessage!.length).toBeGreaterThan(0);
  });

  it('should truncate long event names to 100 characters', () => {
    const longName = 'A'.repeat(150);
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      longName,
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('A'.repeat(100) + '...');
    expect(mailData.textMessage).not.toContain('A'.repeat(101));
  });

  it('should not truncate event names under 100 characters', () => {
    const shortName = 'Community Meetup';
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      shortName,
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('Community Meetup');
  });

  it('should truncate long descriptions to 200 characters', () => {
    const longDesc = 'B'.repeat(250);
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      longDesc,
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('B'.repeat(200) + '...');
    expect(mailData.textMessage).not.toContain('B'.repeat(201));
  });

  it('should include report category in rendered output', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'harassment',
      'Harassing content',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('harassment');
    expect(mailData.htmlMessage).toContain('harassment');
  });

  it('should include calendar name in rendered output', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'City Events Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('City Events Calendar');
    expect(mailData.htmlMessage).toContain('City Events Calendar');
  });

  it('should include deadline in rendered output when provided', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      '2026-02-14',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('2026-02-14');
    expect(mailData.htmlMessage).toContain('2026-02-14');
  });

  it('should include review URL in rendered output', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('/calendar/cal-123/reports');
    expect(mailData.htmlMessage).toContain('/calendar/cal-123/reports');
  });

  it('should include priority in rendered output', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('high');
    expect(mailData.htmlMessage).toContain('high');
  });

  it('should pass the language to template rendering', () => {
    const email = new AdminReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'high',
      null,
      'cal-123',
    );

    const renderPlaintextSpy = sandbox.spy(email, 'renderPlaintext');
    const renderHtmlSpy = sandbox.spy(email, 'renderHtml');

    email.buildMessage('fr');

    expect(renderPlaintextSpy.calledOnce).toBe(true);
    expect(renderPlaintextSpy.firstCall.args[0]).toBe('fr');
    expect(renderHtmlSpy.calledOnce).toBe(true);
    expect(renderHtmlSpy.firstCall.args[0]).toBe('fr');
  });
});
