import { describe, it, expect, beforeEach } from 'vitest';

import { EmailStore } from '@/server/email/transport/testing-transport';
import EmailInterface from '@/server/email/interface';
import TestEmailRoutes from '@/server/common/test-support/test-emails';
import express from 'express';
import request from 'supertest';

/**
 * Integration tests for test-only email API endpoints.
 *
 * These tests verify:
 * - GET /api/test/emails returns all stored emails
 * - GET /api/test/emails?recipient=... filters by recipient
 * - GET /api/test/emails/latest returns the most recent email
 * - DELETE /api/test/emails clears the email store
 * - Production guard returns 404
 */
describe('Test Email API Routes', () => {
  let app: express.Application;
  let store: EmailStore;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    const emailInterface = new EmailInterface();
    const routes = new TestEmailRoutes(emailInterface);
    routes.installHandlers(app);

    store = EmailStore.getInstance();
    store.clear();
  });

  function seedEmail(overrides: Partial<{ from: string; to: string | string[]; subject: string; text: string; html: string }> = {}) {
    const email = {
      id: `<test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@test>`,
      date: new Date(),
      from: overrides.from || 'noreply@pavillion.test',
      to: overrides.to || 'user@example.com',
      subject: overrides.subject || 'Test Subject',
      text: overrides.text || 'Test body',
      html: overrides.html,
      raw: 'raw content',
    };
    store.store(email);
    return email;
  }

  describe('GET /api/test/emails', () => {
    it('should return empty array when no emails stored', async () => {
      const res = await request(app).get('/api/test/emails');
      expect(res.status).toBe(200);
      expect(res.body.emails).toEqual([]);
    });

    it('should return all stored emails', async () => {
      seedEmail({ subject: 'First' });
      seedEmail({ subject: 'Second' });

      const res = await request(app).get('/api/test/emails');
      expect(res.status).toBe(200);
      expect(res.body.emails).toHaveLength(2);
      expect(res.body.emails[0].subject).toBe('First');
      expect(res.body.emails[1].subject).toBe('Second');
    });

    it('should filter by recipient when query param provided', async () => {
      seedEmail({ to: 'alice@example.com', subject: 'For Alice' });
      seedEmail({ to: 'bob@example.com', subject: 'For Bob' });

      const res = await request(app)
        .get('/api/test/emails')
        .query({ recipient: 'alice@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.emails).toHaveLength(1);
      expect(res.body.emails[0].subject).toBe('For Alice');
    });
  });

  describe('GET /api/test/emails/latest', () => {
    it('should return 404 when no emails stored', async () => {
      const res = await request(app).get('/api/test/emails/latest');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('No emails found');
    });

    it('should return the most recent email', async () => {
      seedEmail({ subject: 'Older' });
      seedEmail({ subject: 'Newer' });

      const res = await request(app).get('/api/test/emails/latest');
      expect(res.status).toBe(200);
      expect(res.body.email.subject).toBe('Newer');
    });
  });

  describe('DELETE /api/test/emails', () => {
    it('should clear all stored emails', async () => {
      seedEmail();
      seedEmail();

      const deleteRes = await request(app).delete('/api/test/emails');
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.success).toBe(true);

      const getRes = await request(app).get('/api/test/emails');
      expect(getRes.body.emails).toHaveLength(0);
    });
  });

  describe('Production guard', () => {
    it('should return 404 in production mode', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        const prodApp = express();
        prodApp.use(express.json());
        const emailInterface = new EmailInterface();
        const routes = new TestEmailRoutes(emailInterface);
        routes.installHandlers(prodApp);

        const res = await request(prodApp).get('/api/test/emails');
        expect(res.status).toBe(404);
        expect(res.body.error).toBe('Not found');
      }
      finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
