import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import i18next from 'i18next';
import EscalationReminderEmail from '../../model/escalation_reminder_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * Tests for EscalationReminderEmail model.
 *
 * Verifies that the email model correctly builds messages
 * with time remaining, link to review dashboard, and urgency messaging.
 */
describe('EscalationReminderEmail', () => {
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
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      'This event is spam',
      '12 hours',
      'cal-123',
    );

    expect(email.namespace).toBe('escalation_reminder_email');
  });

  it('should store constructor parameters correctly', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Community Meetup',
      'inappropriate',
      'Contains inappropriate content',
      '6 hours',
      'cal-456',
    );

    expect(email.recipientEmail).toBe('owner@example.com');
    expect(email.eventName).toBe('Community Meetup');
    expect(email.reportCategory).toBe('inappropriate');
    expect(email.reportDescription).toBe('Contains inappropriate content');
    expect(email.timeRemaining).toBe('6 hours');
    expect(email.calendarId).toBe('cal-456');
  });

  it('should set the correct email address in buildMessage', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      'Spam event',
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.emailAddress).toBe('owner@example.com');
  });

  it('should render the subject via i18n', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      'Spam event',
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(i18nextSetDefaultNamespaceStub.calledWith('escalation_reminder_email')).toBe(true);
    expect(mailData.subject).toBe('Translated Subject');
  });

  it('should include text and html messages', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      'Spam event',
      '12 hours',
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
    const email = new EscalationReminderEmail(
      'owner@example.com',
      longName,
      'spam',
      'Spam event',
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('A'.repeat(100) + '...');
    expect(mailData.textMessage).not.toContain('A'.repeat(101));
  });

  it('should not truncate event names under 100 characters', () => {
    const shortName = 'Community Meetup';
    const email = new EscalationReminderEmail(
      'owner@example.com',
      shortName,
      'spam',
      'Spam event',
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('Community Meetup');
  });

  it('should truncate long descriptions to 200 characters', () => {
    const longDesc = 'B'.repeat(250);
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      longDesc,
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('B'.repeat(200) + '...');
    expect(mailData.textMessage).not.toContain('B'.repeat(201));
  });

  it('should include time remaining in rendered output', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      'Spam event',
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('12 hours');
    expect(mailData.htmlMessage).toContain('12 hours');
  });

  it('should include report category in rendered output', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'harassment',
      'Harassing content',
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('harassment');
    expect(mailData.htmlMessage).toContain('harassment');
  });

  it('should include review URL in rendered output', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      'Spam event',
      '12 hours',
      'cal-123',
    );

    const mailData = email.buildMessage('en');

    expect(mailData.textMessage).toContain('/calendar/cal-123/reports');
    expect(mailData.htmlMessage).toContain('/calendar/cal-123/reports');
  });

  it('should pass the language to template rendering', () => {
    const email = new EscalationReminderEmail(
      'owner@example.com',
      'Test Event',
      'spam',
      'Spam event',
      '12 hours',
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
