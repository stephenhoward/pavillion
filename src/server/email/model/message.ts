import fs from 'fs';
import path from 'path';
import { TemplateDelegate } from 'handlebars';
import handlebars from 'handlebars';
import i18next from 'i18next';
import { MailData } from '@/server/email/model/types';

/**
 * Compiles a Handlebars template from a file.
 *
 * @param projectPath - Base path to the project/domain directory
 * @param templateFile - Name of the template file within the templates directory
 * @returns Compiled Handlebars template function
 */
export const compileTemplate = (projectPath: string, templateFile: string): TemplateDelegate<any> => {
  const templateSource = fs.readFileSync(
    path.join(projectPath, 'templates', templateFile),
    'utf8',
  );

  return handlebars.compile(templateSource);
};

/**
 * Abstract base class for email messages with template support.
 *
 * Provides i18n integration for subjects and Handlebars template rendering
 * for plaintext and HTML content. Subclasses implement buildMessage() to
 * construct the complete email with specific data.
 */
export abstract class EmailMessage {
  textTemplate: TemplateDelegate<any>;
  htmlTemplate: TemplateDelegate<any> | undefined;
  namespace: string;

  /**
   * Build the complete email message with all content.
   *
   * @param language - Language code for translations
   * @returns Complete mail data ready for sending
   */
  abstract buildMessage(language: string): MailData;

  /**
   * Creates an EmailMessage with template support.
   *
   * @param namespace - i18n namespace for translations
   * @param textTemplate - Compiled Handlebars template for plaintext content
   * @param htmlTemplate - Optional compiled Handlebars template for HTML content
   */
  constructor(namespace: string, textTemplate: TemplateDelegate<any>, htmlTemplate?: TemplateDelegate<any>) {
    this.namespace = namespace;
    this.textTemplate = textTemplate;
    this.htmlTemplate = htmlTemplate;

    // Add namespace if it doesn't already exist
    if (!i18next.hasResourceBundle('en', namespace)) {
      i18next.loadNamespaces(namespace);
    }
  }

  /**
   * Renders the email subject using i18n translations.
   *
   * @param language - Language code for translation
   * @param data - Data object (language is added to it)
   * @returns Translated subject string
   */
  renderSubject(language: string, data: any): string {
    data.lng = language;
    i18next.setDefaultNamespace(this.namespace);
    return i18next.t('subject', { lng: language });
  }

  /**
   * Renders the plaintext email body using Handlebars template.
   *
   * @param language - Language code passed to template
   * @param data - Data object for template rendering
   * @returns Rendered plaintext content
   */
  renderPlaintext(language: string, data: any): string {
    data.lng = language;
    i18next.setDefaultNamespace(this.namespace);

    return this.textTemplate(data);
  }

  /**
   * Renders the HTML email body using Handlebars template.
   *
   * @param language - Language code passed to template
   * @param data - Data object for template rendering
   * @returns Rendered HTML content, or undefined if no HTML template
   */
  renderHtml(language: string, data: any): string|undefined {
    data.lng = language;
    i18next.setDefaultNamespace(this.namespace);

    return this.htmlTemplate ? this.htmlTemplate(data) : undefined;
  }
}
