import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import main from '@/server/app';

/**
 * Integration tests to verify that error messages don't expose sensitive
 * system information like stack traces, internal paths, or database details.
 *
 * Note: Some tests expect 503 status codes because the system is in setup mode
 * during integration tests. The important verification is that even these
 * setup-mode responses don't expose sensitive information.
 */
describe('Error Information Exposure Prevention', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await main();
  });

  describe('Authentication Endpoints', () => {
    it('should not expose system details on invalid login', async () => {
      const response = await request(app)
        .post('/api/v1/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'wrongpassword',
        });

      // Should return an error
      expect(response.status).toBeGreaterThanOrEqual(400);

      // Response should not contain stack traces or file paths
      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/at\s+\w+\s+\(/); // Stack trace pattern
      expect(body).not.toMatch(/\/Users\//); // Unix path
      expect(body).not.toMatch(/C:\\/); // Windows path
      expect(body).not.toMatch(/\.ts:/); // TypeScript file reference
      expect(body).not.toMatch(/\.js:/); // JavaScript file reference
      expect(body).not.toMatch(/Error:\s*\w+Error/); // Error class names

      // Should have a user-friendly error message (if not in setup mode)
      // In setup mode, responses may be empty - that's acceptable for this test
      if (response.body && Object.keys(response.body).length > 0) {
        // If there's a body, ensure it doesn't have sensitive fields
        expect(response.body).not.toHaveProperty('stack');
        expect(response.body).not.toHaveProperty('stackTrace');
      }
    });

    it('should not expose system details on password reset errors', async () => {
      const response = await request(app)
        .post('/api/v1/reset-password')
        .send({
          email: 'test@example.com',
        });

      // Should succeed (or fail gracefully)
      const body = JSON.stringify(response.body);

      // Response should not contain stack traces or file paths
      expect(body).not.toMatch(/at\s+\w+\s+\(/);
      expect(body).not.toMatch(/\/Users\//);
      expect(body).not.toMatch(/C:\\/);
      expect(body).not.toMatch(/\.ts:/);
      expect(body).not.toMatch(/Error:\s*\w+Error/);

      // Should not expose stack traces
      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('stackTrace');
    });

    it('should include errorName field in password validation errors (when not in setup mode)', async () => {
      const response = await request(app)
        .post('/api/v1/reset-password/invalid-token')
        .send({ password: 'short' }); // Too short to pass validation

      // In setup mode, this returns 503. Outside setup mode, it should return 400
      // Either way, should not expose sensitive information
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('stackTrace');

      // If not in setup mode (status 400), verify errorName is present
      if (response.status === 400) {
        expect(response.body).toHaveProperty('errorName');
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should include errorName field in password reset errors (when not in setup mode)', async () => {
      const response = await request(app)
        .post('/api/v1/reset-password/invalid-token')
        .send({ password: 'ValidPassword123!' }); // Valid password but invalid token

      // In setup mode, this returns 503. Outside setup mode, it should return 400
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('stackTrace');

      // If not in setup mode (status 400), verify errorName and specific error type
      if (response.status === 400) {
        expect(response.body).toHaveProperty('errorName');
        expect(response.body.errorName).toBe('PasswordResetError');
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should include errorName field in token refresh errors (when not in setup mode)', async () => {
      // Attempt to refresh token without being logged in
      const response = await request(app)
        .get('/api/v1/token');

      // In setup mode, this returns 503. Outside setup mode, it should return 400
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('stackTrace');

      // If not in setup mode, verify errorName is present
      if (response.status !== 503) {
        expect(response.body).toHaveProperty('errorName');
        expect(response.body.errorName).toBe('TokenRefreshError');
        expect(response.body).toHaveProperty('error');
      }
    });

    it('should not expose sensitive information in password reset generation (when not in setup mode)', async () => {
      // This test verifies the error format when internal errors occur
      const response = await request(app)
        .post('/api/v1/reset-password')
        .send({ email: 'test@example.com' });

      // Should succeed or fail gracefully (not 500)
      // In setup mode returns 503, outside setup mode should be 200 or 4xx
      expect(response.status).not.toBe(500);
      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('stackTrace');

      // Verify no sensitive data in response body
      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/at\s+\w+\s+\(/);
      expect(body).not.toMatch(/\/src\//);
      expect(body).not.toMatch(/SequelizeError/);
    });
  });

  describe('Calendar API Endpoints', () => {
    it('should not expose system details when accessing non-existent calendar', async () => {
      const response = await request(app)
        .get('/api/v1/calendars/nonexistent-calendar/events');

      // Should return 404 or 401
      expect(response.status).toBeGreaterThanOrEqual(400);

      const body = JSON.stringify(response.body);

      // Response should not contain stack traces or file paths
      expect(body).not.toMatch(/at\s+\w+\s+\(/);
      expect(body).not.toMatch(/\/Users\//);
      expect(body).not.toMatch(/C:\\/);
      expect(body).not.toMatch(/\.ts:/);
      expect(body).not.toMatch(/Error:\s*\w+Error/);
      expect(body).not.toMatch(/SequelizeError/); // Database error
      expect(body).not.toMatch(/SQLITE_/); // SQLite error codes
    });

    it('should not expose system details when creating event without auth', async () => {
      const response = await request(app)
        .post('/api/v1/events')
        .send({
          title: 'Test Event',
          calendarId: 'some-id',
        });

      // Should return 401 or 400
      expect(response.status).toBeGreaterThanOrEqual(400);

      const body = JSON.stringify(response.body);

      // Response should not contain stack traces or file paths
      expect(body).not.toMatch(/at\s+\w+\s+\(/);
      expect(body).not.toMatch(/\/Users\//);
      expect(body).not.toMatch(/C:\\/);
      expect(body).not.toMatch(/\.ts:/);
      expect(body).not.toMatch(/SequelizeError/);
    });
  });

  describe('Category API Endpoints', () => {
    it('should not expose system details when accessing non-existent category', async () => {
      const response = await request(app)
        .get('/api/v1/calendars/fake-id/categories/fake-category-id');

      const body = JSON.stringify(response.body);

      // Response should not contain stack traces or file paths
      expect(body).not.toMatch(/at\s+\w+\s+\(/);
      expect(body).not.toMatch(/\/Users\//);
      expect(body).not.toMatch(/C:\\/);
      expect(body).not.toMatch(/\.ts:/);
      expect(body).not.toMatch(/SequelizeError/);
      expect(body).not.toMatch(/SQLITE_/);
    });
  });

  describe('Public API Endpoints', () => {
    it('should not expose system details when accessing non-existent public calendar', async () => {
      const response = await request(app)
        .get('/api/public/v1/calendars/nonexistent/events');

      expect(response.status).toBeGreaterThanOrEqual(400);

      const body = JSON.stringify(response.body);

      // Response should not contain stack traces or file paths
      expect(body).not.toMatch(/at\s+\w+\s+\(/);
      expect(body).not.toMatch(/\/Users\//);
      expect(body).not.toMatch(/C:\\/);
      expect(body).not.toMatch(/\.ts:/);
      expect(body).not.toMatch(/SequelizeError/);
    });
  });

  describe('Generic Error Patterns', () => {
    it('responses should never contain stack property', async () => {
      // Test multiple endpoints to ensure no stack traces leak
      const endpoints = [
        { method: 'get', path: '/api/v1/calendars/nonexistent/events' },
        { method: 'get', path: '/api/v1/events/invalid-uuid' },
        { method: 'post', path: '/api/v1/events' },
      ];

      for (const endpoint of endpoints) {
        const response = await (request(app) as any)[endpoint.method](endpoint.path);
        expect(response.body).not.toHaveProperty('stack');
        expect(response.body).not.toHaveProperty('stackTrace');
      }
    });

    it('responses should never contain internal file paths', async () => {
      const endpoints = [
        { method: 'get', path: '/api/v1/calendars/nonexistent/events' },
        { method: 'post', path: '/api/v1/login', data: { email: 'test', password: 'test' } },
      ];

      for (const endpoint of endpoints) {
        const req = (request(app) as any)[endpoint.method](endpoint.path);
        const response = endpoint.data ? await req.send(endpoint.data) : await req;

        const body = JSON.stringify(response.body);
        // Should not contain file system paths
        expect(body).not.toMatch(/\/src\//);
        expect(body).not.toMatch(/\/node_modules\//);
        expect(body).not.toMatch(/\/server\//);
        expect(body).not.toMatch(/\/common\//);
      }
    });

    it('responses should never contain database error details', async () => {
      const response = await request(app)
        .get('/api/v1/calendars/test/events');

      const body = JSON.stringify(response.body);

      // Should not contain database-specific error messages
      expect(body).not.toMatch(/SQLITE_/);
      expect(body).not.toMatch(/SequelizeError/);
      expect(body).not.toMatch(/Foreign key constraint/);
      expect(body).not.toMatch(/unique constraint/i);
      expect(body).not.toMatch(/violates/);
      expect(body).not.toMatch(/SELECT.*FROM/); // SQL queries
    });
  });
});
