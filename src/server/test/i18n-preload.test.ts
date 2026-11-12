import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

import { createI18nConfig } from '@/common/i18n/config';
import { getSupportedLanguageCodes } from '@/common/i18n/languages';

// Mirrors the server.ts init: no `lng`, no `ns`, namespaces loaded on demand. The shared
// email test helper preloads its own languages and namespaces, so it cannot catch a
// production config that leaves es/fr unloaded.
describe('server i18next init', () => {
  it('renders es and fr email subjects, not the English fallback, for a lazily loaded namespace', async () => {
    const instance = i18next.createInstance();
    await instance.use(Backend).init(createI18nConfig({
      initAsync: false,
      preload: getSupportedLanguageCodes(),
      backend: {
        loadPath: path.join(path.resolve(), 'src/server/locales/{{lng}}/{{ns}}.json'),
      },
    }));

    const ns = 'application_confirmation_email';
    await instance.loadNamespaces(ns);

    const en = instance.t('subject', { ns, lng: 'en' });
    const es = instance.t('subject', { ns, lng: 'es' });
    const fr = instance.t('subject', { ns, lng: 'fr' });

    expect(en).toBe('Confirm your email address');
    expect(es).not.toBe(en);
    expect(fr).not.toBe(en);
    expect(es).not.toBe(fr);
  });
});
