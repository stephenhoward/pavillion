import { describe, it, expect } from 'vitest';
import handlebars from 'handlebars';
import { EmailMessage } from '@/server/common/email/message';
import { MailData } from '@/server/common/email/types';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

/**
 * The Handlebars `t` helper reads `language` from the template data root. The
 * base class must supply it so a subclass that forgets it still renders the
 * recipient's language in the body.
 */

const TEMPLATE = '{{t \'subject\' calendarName=\'Club\'}}';

class NoLanguageEmail extends EmailMessage {
  constructor() {
    super('editor_notification_email', handlebars.compile(TEMPLATE), handlebars.compile(TEMPLATE));
  }

  buildMessage(language: string): MailData {
    const data = { calendarName: 'Club' };
    return {
      emailAddress: 'x@example.com',
      subject: this.renderSubject(language, data),
      textMessage: this.renderPlaintext(language, data),
      htmlMessage: this.renderHtml(language, data),
    };
  }
}

describe('EmailMessage body language', () => {
  const email = new NoLanguageEmail();
  const spanish = 'Ya puedes editar Club';

  it('renders the plaintext body in the given language when data omits language', () => {
    expect(email.renderPlaintext('es', {})).toBe(spanish);
  });

  it('renders the HTML body in the given language when data omits language', () => {
    expect(email.renderHtml('es', {})).toBe(spanish);
  });

  it('does not mutate the caller\'s data object', () => {
    const data = { calendarName: 'Club' };
    email.renderPlaintext('es', data);
    email.renderHtml('es', data);
    email.renderSubject('es', data);

    expect(data).toEqual({ calendarName: 'Club' });
  });
});
