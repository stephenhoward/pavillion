import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import i18next from 'i18next';
import handlebars from 'handlebars';
import NewReportNotificationEmail from '../../model/new_report_notification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Tests for NewReportNotificationEmail model.
 *
 * Verifies that the email model correctly builds messages
 * with the expected recipient, subject, and template data.
 */
describe('NewReportNotificationEmail', () => {
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
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      3,
    );

    expect(email.namespace).toBe('new_report_notification_email');
  });

  it('should store constructor parameters correctly', () => {
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Community Meetup',
      'inappropriate',
      5,
    );

    expect(email.recipientEmail).toBe('owner@example.com');
    expect(email.eventName).toBe('Community Meetup');
    expect(email.reportCategory).toBe('inappropriate');
    expect(email.reportCount).toBe(5);
  });

  it('should set the correct email address in buildMessage', () => {
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      1,
    );

    const mailData = email.buildMessage('en');

    expect(mailData.emailAddress).toBe('owner@example.com');
  });

  it('should render the subject via i18n', () => {
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      1,
    );

    const mailData = email.buildMessage('en');

    expect(i18nextSetDefaultNamespaceStub.calledWith('new_report_notification_email')).toBe(true);
    expect(mailData.subject).toBe('Translated Subject');
  });

  it('should include text and html messages', () => {
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      2,
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toBeDefined();
    expect(mailData.textMessage.length).toBeGreaterThan(0);
    expect(mailData.htmlMessage).toBeDefined();
    expect(mailData.htmlMessage!.length).toBeGreaterThan(0);
  });

  it('should truncate long event names to 100 characters', () => {
    const longName = 'A'.repeat(150);
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      longName,
      'spam',
      1,
    );

    const mailData = email.buildMessage('en');

    // The truncated name should be 100 chars + '...'
    expect(mailData.textMessage).toContain('A'.repeat(100) + '...');
    expect(mailData.textMessage).not.toContain('A'.repeat(101));
  });

  it('should not truncate event names under 100 characters', () => {
    const shortName = 'Community Meetup';
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      shortName,
      'spam',
      1,
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('Community Meetup');
  });

  it('should include report category in rendered output', () => {
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'harassment',
      1,
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('harassment');
    expect(mailData.htmlMessage).toContain('harassment');
  });

  it('should include report count in rendered output', () => {
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      7,
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('7');
    expect(mailData.htmlMessage).toContain('7');
  });

  it('should pass the language to template rendering', () => {
    const email = new NewReportNotificationEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      1,
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
