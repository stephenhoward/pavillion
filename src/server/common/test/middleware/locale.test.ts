import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { Express, Request, Response } from 'express';
import request from 'supertest';
import sinon from 'sinon';
import { localeMiddleware } from '@/server/common/middleware/locale';
import ServiceSettings from '@/server/configuration/service/settings';
import { Account } from '@/common/model/account';

describe('localeMiddleware', () => {
  let app: Express;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    app = express();
    app.use(localeMiddleware);
    app.get('*', (req: Request, res: Response) => {
      res.json({ locale: req.locale });
    });
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('detection chain priority', () => {
    it('should detect locale from URL prefix first', async () => {
      const response = await request(app)
        .get('/es/some-path')
        .set('Cookie', 'pavilion_locale=fr')
        .set('Accept-Language', 'de');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });

    it('should fall back to cookie when no URL prefix is present', async () => {
      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=es')
        .set('Accept-Language', 'de');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });

    it('should fall back to Accept-Language when no URL prefix or cookie', async () => {
      const response = await request(app)
        .get('/some-path')
        .set('Accept-Language', 'es,en;q=0.9');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });

    it('should fall back to instance default when no URL prefix, cookie, or Accept-Language', async () => {
      const mockSettings = {
        get: (_key: string) => 'es',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });

    it('should fall back to en when all other sources fail', async () => {
      const mockSettings = {
        get: (_key: string) => undefined,
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('en');
    });
  });

  describe('URL prefix detection', () => {
    it('should detect es from /es/... path', async () => {
      const response = await request(app).get('/es/calendar');
      expect(response.body.locale).toBe('es');
    });

    it('should detect en from /en/... path', async () => {
      const response = await request(app).get('/en/calendar');
      expect(response.body.locale).toBe('en');
    });

    it('should not detect locale from non-locale path segment', async () => {
      // 'xx' is not a valid language code
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app).get('/xx/calendar');
      // 'xx' is not a valid language, falls through to instance default
      expect(response.body.locale).toBe('en');
    });

    it('should handle root path without locale prefix', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app).get('/');
      expect(response.body.locale).toBe('en');
    });
  });

  describe('account language detection', () => {
    it('should use account language when user is authenticated', async () => {
      const accountApp = express();

      // Add a middleware that sets req.user before the locale middleware
      accountApp.use((req: Request, _res: Response, next) => {
        const account = new Account('id', 'testuser', 'test@example.com');
        account.language = 'es';
        req.user = account as any;
        next();
      });
      accountApp.use(localeMiddleware);
      accountApp.get('*', (req: Request, res: Response) => {
        res.json({ locale: req.locale });
      });

      const response = await request(accountApp)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=fr')
        .set('Accept-Language', 'de');

      expect(response.body.locale).toBe('es');
    });

    it('should skip account language when user has invalid language code', async () => {
      const accountApp = express();

      accountApp.use((req: Request, _res: Response, next) => {
        const account = new Account('id', 'testuser', 'test@example.com');
        account.language = 'zz'; // invalid code
        req.user = account as any;
        next();
      });
      accountApp.use(localeMiddleware);
      accountApp.get('*', (req: Request, res: Response) => {
        res.json({ locale: req.locale });
      });

      const response = await request(accountApp)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=es');

      // Should fall back to cookie since account language is invalid
      expect(response.body.locale).toBe('es');
    });
  });

  describe('cookie detection', () => {
    it('should read pavilion_locale cookie', async () => {
      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=es');

      expect(response.body.locale).toBe('es');
    });

    it('should ignore invalid language code in cookie', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=zz');

      // 'zz' is invalid, falls through to instance default
      expect(response.body.locale).toBe('en');
    });

    it('should handle missing cookie gracefully', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app).get('/some-path');
      expect(response.body.locale).toBe('en');
    });

    it('should handle multiple cookies and pick the correct one', async () => {
      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'other_cookie=xyz; pavilion_locale=es; another=abc');

      expect(response.body.locale).toBe('es');
    });
  });

  describe('Accept-Language detection', () => {
    it('should pick the highest quality supported language', async () => {
      const response = await request(app)
        .get('/some-path')
        .set('Accept-Language', 'es;q=0.9,en;q=0.8');

      expect(response.body.locale).toBe('es');
    });

    it('should skip unsupported languages in Accept-Language', async () => {
      const response = await request(app)
        .get('/some-path')
        .set('Accept-Language', 'fr;q=0.9,es;q=0.8');

      // 'fr' is not supported, should fall back to 'es'
      expect(response.body.locale).toBe('es');
    });

    it('should fall through when Accept-Language contains only unsupported languages', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Accept-Language', 'fr,de,it');

      expect(response.body.locale).toBe('en');
    });

    it('should handle missing Accept-Language header', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app).get('/some-path');
      expect(response.body.locale).toBe('en');
    });
  });

  describe('instance default detection', () => {
    it('should use instance default language from settings service', async () => {
      const mockSettings = {
        get: (_key: string) => 'es',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app).get('/some-path');
      expect(response.body.locale).toBe('es');
    });

    it('should fall back to en when settings service throws', async () => {
      sandbox.stub(ServiceSettings, 'getInstance').rejects(new Error('DB error'));

      const response = await request(app).get('/some-path');
      expect(response.body.locale).toBe('en');
    });

    it('should fall back to en when settings service returns invalid language', async () => {
      const mockSettings = {
        get: (_key: string) => 'zz',
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app).get('/some-path');
      expect(response.body.locale).toBe('en');
    });
  });

  describe('req.locale availability', () => {
    it('should set req.locale before calling next()', async () => {
      const locales: string[] = [];

      const testApp = express();
      testApp.use(localeMiddleware);
      testApp.use((req: Request, _res: Response, next) => {
        locales.push(req.locale);
        next();
      });
      testApp.get('*', (req: Request, res: Response) => {
        res.json({ locale: req.locale });
      });

      await request(testApp)
        .get('/some-path')
        .set('Accept-Language', 'es');

      expect(locales).toHaveLength(1);
      expect(locales[0]).toBe('es');
    });

    it('should always produce a non-empty string locale', async () => {
      const mockSettings = {
        get: (_key: string) => undefined,
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app).get('/some-path');
      expect(typeof response.body.locale).toBe('string');
      expect(response.body.locale.length).toBeGreaterThan(0);
    });
  });
});


describe('localeMiddleware admin overrides', () => {
  let app: Express;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    app = express();
    app.use(localeMiddleware);
    app.get('*', (req: Request, res: Response) => {
      res.json({ locale: req.locale });
    });
  });

  afterEach(() => {
    sandbox.restore();
    vi.restoreAllMocks();
  });

  describe('forceLanguage', () => {
    it('should use forceLanguage regardless of URL prefix', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => 'es',
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: true }),
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/en/some-path')
        .set('Accept-Language', 'en');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });

    it('should use forceLanguage regardless of cookie', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => 'es',
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: true }),
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=en');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });

    it('should fall through to detection chain when forceLanguage is null', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: true }),
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=es');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });
  });

  describe('localeDetectionMethods', () => {
    it('should skip URL prefix detection when urlPrefix is disabled', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: false, cookie: true, acceptLanguage: true }),
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/es/some-path');

      // URL prefix disabled, should fall through to instance default
      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('en');
    });

    it('should skip cookie detection when cookie is disabled', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: false, acceptLanguage: true }),
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=es');

      // Cookie disabled, falls through to Accept-Language then instance default
      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('en');
    });

    it('should skip Accept-Language detection when acceptLanguage is disabled', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: false }),
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Accept-Language', 'es');

      // Accept-Language disabled, falls through to instance default
      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('en');
    });
  });

  describe('enabledLanguages', () => {
    it('should fall back to instance default when detected locale is not in enabledLanguages', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: true }),
        getEnabledLanguages: () => ['en'], // only English enabled
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=es'); // Spanish not enabled

      // Spanish is not in enabledLanguages, falls through to instance default (en)
      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('en');
    });

    it('should fall back to instance default when URL prefix locale is not in enabledLanguages', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: true }),
        getEnabledLanguages: () => ['en'], // only English enabled
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/es/some-path'); // Spanish not enabled

      // Spanish is not in enabledLanguages, falls through to instance default (en)
      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('en');
    });

    it('should fall back to instance default when Accept-Language locale is not in enabledLanguages', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: true }),
        getEnabledLanguages: () => ['en'], // only English enabled
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Accept-Language', 'es'); // Spanish not enabled

      // Spanish is not in enabledLanguages, falls through to instance default (en)
      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('en');
    });

    it('should allow enabled locale from cookie', async () => {
      const mockSettings = {
        get: (_key: string) => 'en',
        getForceLanguage: () => null,
        getLocaleDetectionMethods: () => ({ urlPrefix: true, cookie: true, acceptLanguage: true }),
        getEnabledLanguages: () => ['en', 'es'], // both enabled
      } as unknown as ServiceSettings;

      sandbox.stub(ServiceSettings, 'getInstance').resolves(mockSettings);

      const response = await request(app)
        .get('/some-path')
        .set('Cookie', 'pavilion_locale=es');

      expect(response.status).toBe(200);
      expect(response.body.locale).toBe('es');
    });
  });
});
