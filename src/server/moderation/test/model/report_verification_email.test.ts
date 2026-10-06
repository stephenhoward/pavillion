import { describe, it, expect } from 'vitest';
import config from 'config';

import ReportVerificationEmail from '@/server/moderation/model/report_verification_email';
import { initI18Next } from '@/server/common/test/lib/i18next';

initI18Next();

describe('ReportVerificationEmail', () => {
  const expectedLink = `https://${config.get('domain')}/api/public/v1/reports/verify/verify-token-123`;

  it('renders the absolute link in the plaintext body', () => {
    const message = new ReportVerificationEmail('reporter@example.com', 'Test Event', 'spam', 'verify-token-123').buildMessage('en');

    expect(message.textMessage).toContain(expectedLink);
  });

  it('renders the absolute link as the button href in the HTML body', () => {
    const message = new ReportVerificationEmail('reporter@example.com', 'Test Event', 'spam', 'verify-token-123').buildMessage('en');

    expect(message.htmlMessage).toContain(`href="${expectedLink}"`);
  });
});
