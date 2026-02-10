import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import i18next from 'i18next';
import AutoEscalationNotificationEmail from '../../model/auto_escalation_notification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Tests for AutoEscalationNotificationEmail model.
 *
 * Verifies that the email model correctly builds messages
 * with original report details, calendar owner info,
 * and link to admin review.
 */
describe('AutoEscalationNotificationEmail', () => {
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
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'This event is spam',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    expect(email.namespace).toBe('auto_escalation_notification_email');
  });

  it('should store constructor parameters correctly', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Community Meetup',
      'City Calendar',
      'inappropriate',
      'Contains inappropriate content',
      'owner@example.com',
      '2026-02-05',
      'report-123',
    );

    expect(email.recipientEmail).toBe('admin@example.com');
    expect(email.eventName).toBe('Community Meetup');
    expect(email.calendarName).toBe('City Calendar');
    expect(email.reportCategory).toBe('inappropriate');
    expect(email.reportDescription).toBe('Contains inappropriate content');
    expect(email.ownerEmail).toBe('owner@example.com');
    expect(email.pendingSince).toBe('2026-02-05');
    expect(email.reportId).toBe('report-123');
  });

  it('should set the correct email address in buildMessage', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.emailAddress).toBe('admin@example.com');
  });

  it('should render the subject via i18n', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(i18nextSetDefaultNamespaceStub.calledWith('auto_escalation_notification_email')).toBe(true);
    expect(mailData.subject).toBe('Translated Subject');
  });

  it('should include text and html messages', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toBeDefined();
    expect(mailData.textMessage.length).toBeGreaterThan(0);
    expect(mailData.htmlMessage).toBeDefined();
    expect(mailData.htmlMessage!.length).toBeGreaterThan(0);
  });

  it('should truncate long event names to 100 characters', () => {
    const longName = 'A'.repeat(150);
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      longName,
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('A'.repeat(100) + '...');
    expect(mailData.textMessage).not.toContain('A'.repeat(101));
  });

  it('should not truncate event names under 100 characters', () => {
    const shortName = 'Community Meetup';
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      shortName,
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('Community Meetup');
  });

  it('should truncate long descriptions to 200 characters', () => {
    const longDesc = 'B'.repeat(250);
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      longDesc,
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('B'.repeat(200) + '...');
    expect(mailData.textMessage).not.toContain('B'.repeat(201));
  });

  it('should include report category in rendered output', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'harassment',
      'Harassing content',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('harassment');
    expect(mailData.htmlMessage).toContain('harassment');
  });

  it('should include calendar name in rendered output', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'City Events Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('City Events Calendar');
    expect(mailData.htmlMessage).toContain('City Events Calendar');
  });

  it('should include owner email in rendered output', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('owner@example.com');
    expect(mailData.htmlMessage).toContain('owner@example.com');
  });

  it('should include pending since date in rendered output', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-05',
      'report-uuid',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('2026-02-05');
    expect(mailData.htmlMessage).toContain('2026-02-05');
  });

  it('should include review URL with report ID in rendered output', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('/admin/moderation/reports/report-uuid-123');
    expect(mailData.htmlMessage).toContain('/admin/moderation/reports/report-uuid-123');
  });

  it('should pass the language to template rendering', () => {
    const email = new AutoEscalationNotificationEmail(
      'admin@example.com',
      'Test Event',
      'My Calendar',
      'spam',
      'Spam event',
      'owner@example.com',
      '2026-02-07',
      'report-uuid',
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
