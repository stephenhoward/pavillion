import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import i18next from 'i18next';
import handlebars from 'handlebars';
import { EmailMessage, compileTemplate } from '@/server/email/model/message';
import { MailData } from '@/server/email/model/types';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

// Test implementation of EmailMessage
class TestEmailMessage extends EmailMessage {
  testData: Record<string, any>;

  constructor(namespace: string, textTemplate: handlebars.TemplateDelegate, htmlTemplate?: handlebars.TemplateDelegate, testData: Record<string, any> = {}) {
    super(namespace, textTemplate, htmlTemplate);
    this.testData = testData;
  }

  buildMessage(language: string): MailData {
    return {
      emailAddress: this.testData.emailAddress || 'test@example.com',
      subject: this.renderSubject(language, this.testData),
      textMessage: this.renderPlaintext(language, this.testData),
      htmlMessage: this.renderHtml(language, this.testData),
    };
  }
}

describe('EmailMessage', () => {
  let sandbox: sinon.SinonSandbox;
  let i18nextTStub: sinon.SinonStub;
  let i18nextLoadNamespacesStub: sinon.SinonStub;
  let i18nextHasResourceBundleStub: sinon.SinonStub;
  let i18nextSetDefaultNamespaceStub: sinon.SinonStub;
  let textTemplateMock: handlebars.TemplateDelegate;
  let htmlTemplateMock: handlebars.TemplateDelegate;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // Mock textTemplate and htmlTemplate functions
    textTemplateMock = sandbox.stub().returns('Rendered plaintext content');
    htmlTemplateMock = sandbox.stub().returns('<p>Rendered HTML content</p>');

    // Setup i18next stubs
    i18nextTStub = sandbox.stub();
    i18nextLoadNamespacesStub = sandbox.stub();
    i18nextHasResourceBundleStub = sandbox.stub();
    i18nextSetDefaultNamespaceStub = sandbox.stub();

    // Replace the i18next methods with our stubs
    Object.defineProperty(i18next, 't', { value: i18nextTStub, configurable: true });
    Object.defineProperty(i18next, 'loadNamespaces', { value: i18nextLoadNamespacesStub, configurable: true });
    Object.defineProperty(i18next, 'hasResourceBundle', { value: i18nextHasResourceBundleStub, configurable: true });
    Object.defineProperty(i18next, 'setDefaultNamespace', { value: i18nextSetDefaultNamespaceStub, configurable: true });

    i18nextTStub.returns('Translated Subject');
    i18nextHasResourceBundleStub.returns(false);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should load namespace in constructor if it does not exist', () => {
    const namespace = 'test_email';
    new TestEmailMessage(namespace, textTemplateMock, htmlTemplateMock);

    expect(i18nextLoadNamespacesStub.calledOnceWith(namespace)).toBe(true);
  });

  it('should not load namespace in constructor if it already exists', () => {
    const namespace = 'existing_namespace';
    i18nextHasResourceBundleStub.returns(true);

    new TestEmailMessage(namespace, textTemplateMock, htmlTemplateMock);

    expect(i18nextLoadNamespacesStub.called).toBe(false);
  });

  it('should call i18next.t when rendering subject', () => {
    const namespace = 'test_email';
    const language = 'fr';
    const testMessage = new TestEmailMessage(namespace, textTemplateMock, htmlTemplateMock);

    const result = testMessage.renderSubject(language, { name: 'Test User' });

    expect(i18nextSetDefaultNamespaceStub.calledWith(namespace)).toBe(true);
    expect(i18nextTStub.calledWith('subject', { lng: language })).toBe(true);
    expect(result).toBe('Translated Subject');
  });

  it('should call the text template when rendering plaintext', () => {
    const namespace = 'test_email';
    const language = 'es';
    const data = { name: 'Test User' };

    const testMessage = new TestEmailMessage(namespace, textTemplateMock, htmlTemplateMock);
    const result = testMessage.renderPlaintext(language, data);

    expect(i18nextSetDefaultNamespaceStub.calledWith(namespace)).toBe(true);
    expect(textTemplateMock.calledOnce).toBe(true);
    expect(textTemplateMock.firstCall.args[0]).toMatchObject({
      name: 'Test User',
      lng: language,
    });
    expect(result).toBe('Rendered plaintext content');
  });

  it('should call the html template when rendering HTML if provided', () => {
    const namespace = 'test_email';
    const language = 'de';
    const data = { name: 'Test User' };

    const testMessage = new TestEmailMessage(namespace, textTemplateMock, htmlTemplateMock);
    const result = testMessage.renderHtml(language, data);

    expect(i18nextSetDefaultNamespaceStub.calledWith(namespace)).toBe(true);
    expect(htmlTemplateMock.calledOnce).toBe(true);
    expect(htmlTemplateMock.firstCall.args[0]).toMatchObject({
      name: 'Test User',
      lng: language,
    });
    expect(result).toBe('<p>Rendered HTML content</p>');
  });

  it('should return undefined when rendering HTML if no html template provided', () => {
    const namespace = 'test_email';
    const language = 'it';
    const data = { name: 'Test User' };

    // Create TestEmailMessage without HTML template
    const testMessage = new TestEmailMessage(namespace, textTemplateMock);
    const result = testMessage.renderHtml(language, data);

    expect(i18nextSetDefaultNamespaceStub.calledWith(namespace)).toBe(true);
    expect(htmlTemplateMock.called).toBe(false);
    expect(result).toBeUndefined();
  });

  it('should build complete message with all components', () => {
    const namespace = 'test_email';
    const language = 'en';
    const testData = {
      emailAddress: 'user@example.com',
      name: 'Test User',
    };

    const testMessage = new TestEmailMessage(namespace, textTemplateMock, htmlTemplateMock, testData);

    // Create spies for render methods
    const renderSubjectSpy = sandbox.spy(testMessage, 'renderSubject');
    const renderPlaintextSpy = sandbox.spy(testMessage, 'renderPlaintext');
    const renderHtmlSpy = sandbox.spy(testMessage, 'renderHtml');

    const result = testMessage.buildMessage(language);

    expect(renderSubjectSpy.calledOnceWith(language, testData)).toBe(true);
    expect(renderPlaintextSpy.calledOnceWith(language, testData)).toBe(true);
    expect(renderHtmlSpy.calledOnceWith(language, testData)).toBe(true);

    expect(result).toEqual({
      emailAddress: 'user@example.com',
      subject: 'Translated Subject',
      textMessage: 'Rendered plaintext content',
      htmlMessage: '<p>Rendered HTML content</p>',
    });
  });

  describe('compileTemplate helper function', () => {
    let fsReadFileSyncStub: sinon.SinonStub;
    let handlebarsCompileStub: sinon.SinonStub;

    beforeEach(() => {
      fsReadFileSyncStub = sandbox.stub(fs, 'readFileSync').returns('Template content');
      handlebarsCompileStub = sandbox.stub(handlebars, 'compile').returns(() => 'Compiled template');
    });

    it('should read the template file and compile it with handlebars', () => {
      const projectPath = '/test/project';
      const templateFile = 'email_template.html.hbs';

      const result = compileTemplate(projectPath, templateFile);

      expect(fsReadFileSyncStub.calledWith(
        path.join(projectPath, 'templates', templateFile),
        'utf8',
      )).toBe(true);

      expect(handlebarsCompileStub.calledWith('Template content')).toBe(true);
      expect(typeof result).toBe('function');
    });
  });
});
