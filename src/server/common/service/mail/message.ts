import fs from 'fs';
import path from 'path';
import { TemplateDelegate } from 'handlebars';
import handlebars from 'handlebars';
import i18next from 'i18next';
import { MailData } from '@/server/common/service/mail/types';

export const compileTemplate = (projectPath: string, templateFile: string): TemplateDelegate<any> => {
  const templateSource = fs.readFileSync(
    path.join(projectPath, 'templates', templateFile),
    'utf8',
  );

  return handlebars.compile(templateSource);
};

export abstract class EmailMessage {
  textTemplate: TemplateDelegate<any>;
  htmlTemplate: TemplateDelegate<any> | undefined;
  namespace: string;

  abstract buildMessage(language: string): MailData;

  constructor(namespace: string, textTemplate: TemplateDelegate<any>, htmTemplate?: TemplateDelegate<any>) {
    this.namespace = namespace;
    this.textTemplate = textTemplate;
    this.htmlTemplate = htmTemplate;

    // Add namespace if it doesn't already exist
    if (!i18next.hasResourceBundle('en', namespace)) {
      i18next.loadNamespaces(namespace);
    }
  }

  renderSubject(language: string, data: any): string {
    data.lng = language;
    i18next.setDefaultNamespace(this.namespace);
    return i18next.t('subject', { lng: language });
  }

  renderPlaintext(language: string, data: any): string {
    data.lng = language;
    i18next.setDefaultNamespace(this.namespace);

    return this.textTemplate(data);
  }

  renderHtml(language: string, data: any): string|undefined {
    data.lng = language;
    i18next.setDefaultNamespace(this.namespace);

    return this.htmlTemplate ? this.htmlTemplate(data) : undefined;
  }
}
