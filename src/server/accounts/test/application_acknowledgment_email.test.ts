import { describe, it, expect } from 'vitest';
import AccountApplication from '@/common/model/application';
import ApplicationAcknowledgmentEmail from '@/server/accounts/model/application_acknowledgment_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('ApplicationAcknowledgmentEmail sign-off', () => {
  const build = (name: string) => new ApplicationAcknowledgmentEmail(new AccountApplication('app-id', 'a@example.com'), name);

  it.each(['en', 'es', 'fr'])('signs off with the instance name instead of a team name (%s)', (language) => {
    const message = build('Riverside Events').buildMessage(language);

    expect(message.textMessage.trimEnd()).toMatch(/Riverside Events\s*(-{3,}[\s\S]*)?$/);
    expect(message.htmlMessage).toContain('Riverside Events');
    for (const body of [message.textMessage, message.htmlMessage]) {
      expect(body).not.toContain('Pavillion Team');
      expect(body).not.toContain('The Team');
    }
  });

  it('escapes the instance name in HTML and leaves it literal in text', () => {
    const message = build('Arts & Crafts').buildMessage('en');

    expect(message.htmlMessage).toContain('Arts &amp; Crafts');
    expect(message.textMessage).toContain('Arts & Crafts');
    expect(message.textMessage).not.toContain('&amp;');
  });
});
