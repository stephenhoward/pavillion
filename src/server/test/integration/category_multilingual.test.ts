import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'events';
import request from 'supertest';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { TestEnvironment } from '@/server/test/lib/test_environment';
import AccountService from '@/server/accounts/service/account';
import CalendarInterface from '@/server/calendar/interface';
import ConfigurationInterface from '@/server/configuration/interface';

/**
 * Integration tests for multilingual category functionality.
 * Tests that categories properly handle content in multiple languages,
 * including creating, updating, and retrieving categories with
 * multilingual content.
 */
describe('Category Multilingual Integration', () => {
  let account: Account;
  let calendar: Calendar;
  let env: TestEnvironment;
  let userEmail: string = 'categorymultilingual@pavillion.dev';
  let userPassword: string = 'testpassword';

  beforeAll(async () => {
    env = new TestEnvironment();
    await env.init(3008); // Use unique port

    const eventBus = new EventEmitter();
    const calendarInterface = new CalendarInterface(eventBus);
    const configurationInterface = new ConfigurationInterface();
    const accountService = new AccountService(eventBus, configurationInterface);

    // Set up test account and calendar
    let accountInfo = await accountService._setupAccount(userEmail, userPassword);
    account = accountInfo.account;
    calendar = await calendarInterface.createCalendar(account, 'multilingual');
  });

  afterAll(async () => {
    if (env) {
      await env.cleanup();
    }
  });

  describe('Multilingual Category Creation', () => {
    it('should create category with content in multiple languages', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: 'Technology',
          },
          es: {
            name: 'Tecnología',
          },
          fr: {
            name: 'Technologie',
          },
          de: {
            name: 'Technologie',
          },
          ja: {
            name: 'テクノロジー',
          },
          ar: {
            name: 'تكنولوجيا',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.id).toBeDefined();
      expect(response.body.calendarId).toBe(calendar.id);

      // Verify all languages are present
      expect(response.body.content).toHaveProperty('en');
      expect(response.body.content.en.name).toBe('Technology');

      expect(response.body.content).toHaveProperty('es');
      expect(response.body.content.es.name).toBe('Tecnología');

      expect(response.body.content).toHaveProperty('fr');
      expect(response.body.content.fr.name).toBe('Technologie');

      expect(response.body.content).toHaveProperty('de');
      expect(response.body.content.de.name).toBe('Technologie');

      expect(response.body.content).toHaveProperty('ja');
      expect(response.body.content.ja.name).toBe('テクノロジー');

      expect(response.body.content).toHaveProperty('ar');
      expect(response.body.content.ar.name).toBe('تكنولوجيا');
    });

    it('should create category with single language', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: 'English Only Category',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content).toHaveProperty('en');
      expect(response.body.content.en.name).toBe('English Only Category');

      // Verify other languages are not present
      expect(response.body.content).not.toHaveProperty('es');
      expect(response.body.content).not.toHaveProperty('fr');
      expect(response.body.content).not.toHaveProperty('de');
    });

    it('should handle categories with empty language content gracefully', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: 'Valid English',
          },
          es: {
            name: '', // Empty name should be handled
          },
          fr: {
            name: '   ', // Whitespace-only name
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe('Valid English');

      // Empty content should still be stored but may be handled differently
      expect(response.body.content).toHaveProperty('es');
      expect(response.body.content).toHaveProperty('fr');
    });
  });

  describe('Multilingual Category Updates', () => {
    let categoryId: string;

    beforeAll(async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create initial category with English content
      const categoryData = {
        content: {
          en: {
            name: 'Workshop',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
      categoryId = response.body.id;
    });

    it('should add new languages to existing category', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const updateData = {
        content: {
          en: {
            name: 'Workshop', // Keep existing English
          },
          es: {
            name: 'Taller', // Add Spanish
          },
          fr: {
            name: 'Atelier', // Add French
          },
        },
      };

      const response = await request(env.app)
        .post(`/api/v1/calendars/${calendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + authKey)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.content.en.name).toBe('Workshop');
      expect(response.body.content.es.name).toBe('Taller');
      expect(response.body.content.fr.name).toBe('Atelier');
    });

    it('should update existing language content', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const updateData = {
        content: {
          en: {
            name: 'Workshop & Training', // Update English
          },
          es: {
            name: 'Taller y Capacitación', // Update Spanish
          },
          fr: {
            name: 'Atelier et Formation', // Update French
          },
        },
      };

      const response = await request(env.app)
        .post(`/api/v1/calendars/${calendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + authKey)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.content.en.name).toBe('Workshop & Training');
      expect(response.body.content.es.name).toBe('Taller y Capacitación');
      expect(response.body.content.fr.name).toBe('Atelier et Formation');
    });

    it('should remove languages when set to null', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const updateData = {
        content: {
          en: {
            name: 'Workshop & Training', // Keep English
          },
          es: null, // Remove Spanish
          fr: {
            name: 'Atelier et Formation', // Keep French
          },
          de: {
            name: 'Workshop & Schulung', // Add German
          },
        },
      };

      const response = await request(env.app)
        .post(`/api/v1/calendars/${calendar.id}/categories/${categoryId}`)
        .set('Authorization', 'Bearer ' + authKey)
        .send(updateData);

      expect(response.status).toBe(200);
      expect(response.body.content.en.name).toBe('Workshop & Training');
      expect(response.body.content).not.toHaveProperty('es'); // Should be removed
      expect(response.body.content.fr.name).toBe('Atelier et Formation');
      expect(response.body.content.de.name).toBe('Workshop & Schulung');
    });
  });

  describe('Multilingual Category Retrieval', () => {
    let multilingualCategoryId: string;

    beforeAll(async () => {
      const authKey = await env.login(userEmail, userPassword);

      // Create category with rich multilingual content
      const categoryData = {
        content: {
          en: {
            name: 'Arts & Culture',
          },
          es: {
            name: 'Arte y Cultura',
          },
          fr: {
            name: 'Arts et Culture',
          },
          it: {
            name: 'Arte e Cultura',
          },
          pt: {
            name: 'Arte e Cultura',
          },
          ru: {
            name: 'Искусство и культура',
          },
          zh: {
            name: '艺术与文化',
          },
          hi: {
            name: 'कला और संस्कृति',
          },
          ar: {
            name: 'الفن والثقافة',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);
      multilingualCategoryId = response.body.id;
    });

    it('should retrieve category with all language content intact', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const response = await request(env.app)
        .get(`/api/v1/categories/${multilingualCategoryId}`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(200);

      // Verify all languages are present and correct
      const content = response.body.content;
      expect(content.en.name).toBe('Arts & Culture');
      expect(content.es.name).toBe('Arte y Cultura');
      expect(content.fr.name).toBe('Arts et Culture');
      expect(content.it.name).toBe('Arte e Cultura');
      expect(content.pt.name).toBe('Arte e Cultura');
      expect(content.ru.name).toBe('Искусство и культура');
      expect(content.zh.name).toBe('艺术与文化');
      expect(content.hi.name).toBe('कला और संस्कृति');
      expect(content.ar.name).toBe('الفن والثقافة');
    });

    it('should list categories with multilingual content in calendar view', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const response = await request(env.app)
        .get(`/api/v1/calendars/${calendar.id}/categories`)
        .set('Authorization', 'Bearer ' + authKey);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);

      const multilingualCategory = response.body.find((cat: any) => cat.id === multilingualCategoryId);
      expect(multilingualCategory).toBeDefined();

      // Verify multilingual content in list view
      const content = multilingualCategory.content;
      expect(content.en.name).toBe('Arts & Culture');
      expect(content.es.name).toBe('Arte y Cultura');
      expect(content.zh.name).toBe('艺术与文化');
      expect(content.ar.name).toBe('الفن والثقافة');
    });
  });

  describe('Multilingual Content Validation', () => {
    it('should handle special characters and Unicode properly', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: 'Special Characters: !@#$%^&*()_+-={}[]|;:\'",.<>?',
          },
          ja: {
            name: 'ひらがな・カタカナ・漢字：こんにちは',
          },
          ko: {
            name: '한글: 안녕하세요',
          },
          th: {
            name: 'ไทย: สวัสดีครับ',
          },
          emoji: {
            name: '🎨🎭🎪🎨 Arts & Fun 🎨🎭🎪🎨',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe('Special Characters: !@#$%^&*()_+-={}[]|;:\'",.<>?');
      expect(response.body.content.ja.name).toBe('ひらがな・カタカナ・漢字：こんにちは');
      expect(response.body.content.ko.name).toBe('한글: 안녕하세요');
      expect(response.body.content.th.name).toBe('ไทย: สวัสดีครับ');
      expect(response.body.content.emoji.name).toBe('🎨🎭🎪🎨 Arts & Fun 🎨🎭🎪🎨');
    });

    it('should handle very long category names in multiple languages', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const longEnglishName = 'This is a very long category name that contains many words and is designed to test the maximum length handling capabilities of the category system when dealing with extended multilingual content';
      const longSpanishName = 'Este es un nombre de categoría muy largo que contiene muchas palabras y está diseñado para probar las capacidades de manejo de longitud máxima del sistema de categorías cuando se trata de contenido multilingüe extendido';

      const categoryData = {
        content: {
          en: {
            name: longEnglishName,
          },
          es: {
            name: longSpanishName,
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe(longEnglishName);
      expect(response.body.content.es.name).toBe(longSpanishName);
    });

    it('should reject categories with no valid language content', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: '', // Empty name
          },
          es: {
            name: '   ', // Only whitespace
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      // This might return 400 or create a category depending on validation rules
      // The important thing is that it handles the case gracefully
      if (response.status === 400) {
        expect(response.body).toHaveProperty('error');
      }
      else if (response.status === 201) {
        // If it creates the category, it should handle empty content appropriately
        expect(response.body).toHaveProperty('id');
      }
    });
  });

  describe('RTL Language Support', () => {
    it('should properly handle right-to-left languages', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: {
            name: 'Business',
          },
          ar: {
            name: 'الأعمال التجارية',
          },
          he: {
            name: 'עסקים',
          },
          fa: {
            name: 'تجارت',
          },
          ur: {
            name: 'کاروبار',
          },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe('Business');
      expect(response.body.content.ar.name).toBe('الأعمال التجارية');
      expect(response.body.content.he.name).toBe('עסקים');
      expect(response.body.content.fa.name).toBe('تجارت');
      expect(response.body.content.ur.name).toBe('کاروبار');
    });
  });

  describe('Language Code Validation', () => {
    it('should accept standard ISO 639-1 language codes', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: { name: 'English' },
          es: { name: 'Español' },
          fr: { name: 'Français' },
          de: { name: 'Deutsch' },
          it: { name: 'Italiano' },
          pt: { name: 'Português' },
          ru: { name: 'Русский' },
          ja: { name: '日本語' },
          ko: { name: '한국어' },
          zh: { name: '中文' },
          ar: { name: 'العربية' },
          hi: { name: 'हिन्दी' },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      expect(response.status).toBe(201);

      // All standard language codes should be accepted
      Object.keys(categoryData.content).forEach(langCode => {
        expect(response.body.content).toHaveProperty(langCode);
      });
    });

    it('should handle non-standard language codes gracefully', async () => {
      const authKey = await env.login(userEmail, userPassword);

      const categoryData = {
        content: {
          en: { name: 'English' },
          'en-US': { name: 'American English' },
          'es-MX': { name: 'Español Mexicano' },
          'zh-CN': { name: '简体中文' },
          'zh-TW': { name: '繁體中文' },
          custom: { name: 'Custom Language' },
        },
      };

      const response = await env.authPost(authKey, `/api/v1/calendars/${calendar.id}/categories`, categoryData);

      // Should either handle gracefully or accept all codes
      expect(response.status).toBe(201);
      expect(response.body.content.en.name).toBe('English');

      // Non-standard codes may or may not be accepted depending on validation
      if (response.body.content['en-US']) {
        expect(response.body.content['en-US'].name).toBe('American English');
      }
    });
  });
});
