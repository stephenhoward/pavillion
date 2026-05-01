import { describe, it, expect, beforeEach } from 'vitest';
import express, { Express } from 'express';
import request from 'supertest';
import { validateUUID, validateRequired, validateDateRange } from '@/server/common/middleware/validation';

// Install a simple error handler that serializes ValidationError into JSON
function installErrorHandler(app: Express): void {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: err.message, errorName: err.name });
  });
}

describe('validateUUID', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.get('/items/:id', validateUUID('id'), (_req, res) => {
      res.json({ ok: true });
    });
    installErrorHandler(app);
  });

  it('should pass for a valid UUID v4', async () => {
    const response = await request(app).get('/items/550e8400-e29b-41d4-a716-446655440000');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('should reject a non-UUID param', async () => {
    const response = await request(app).get('/items/not-a-uuid');
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
    expect(response.body.error).toContain("'id'");
  });

  it('should reject a UUID v1 (wrong version digit)', async () => {
    const response = await request(app).get('/items/550e8400-e29b-11d4-a716-446655440000');
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
  });
});

describe('validateRequired', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.post('/items', validateRequired(['title', 'startDate']), (_req, res) => {
      res.json({ ok: true });
    });
    app.get('/search', validateRequired(['q']), (_req, res) => {
      res.json({ ok: true });
    });
    installErrorHandler(app);
  });

  it('should pass when all required body fields are present', async () => {
    const response = await request(app)
      .post('/items')
      .send({ title: 'My Event', startDate: '2026-01-01' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('should reject when a required body field is missing', async () => {
    const response = await request(app)
      .post('/items')
      .send({ title: 'My Event' });
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
    expect(response.body.error).toContain('startDate');
  });

  it('should reject when multiple required fields are missing', async () => {
    const response = await request(app).post('/items').send({});
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('title');
    expect(response.body.error).toContain('startDate');
  });

  it('should pass when required query param is present', async () => {
    const response = await request(app).get('/search?q=hello');
    expect(response.status).toBe(200);
  });

  it('should reject when required query param is missing', async () => {
    const response = await request(app).get('/search');
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
  });
});

describe('validateDateRange', () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.get('/events', validateDateRange(), (_req, res) => {
      res.json({ ok: true });
    });
    installErrorHandler(app);
  });

  it('should pass with no date parameters', async () => {
    const response = await request(app).get('/events');
    expect(response.status).toBe(200);
  });

  it('should pass with a valid startDate only', async () => {
    const response = await request(app).get('/events?startDate=2026-01-01');
    expect(response.status).toBe(200);
  });

  it('should pass with a valid endDate only', async () => {
    const response = await request(app).get('/events?endDate=2026-12-31');
    expect(response.status).toBe(200);
  });

  it('should pass when startDate is before endDate', async () => {
    const response = await request(app).get('/events?startDate=2026-01-01&endDate=2026-12-31');
    expect(response.status).toBe(200);
  });

  it('should reject an invalid startDate', async () => {
    const response = await request(app).get('/events?startDate=not-a-date');
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
    expect(response.body.error).toContain('startDate');
  });

  it('should reject an invalid endDate', async () => {
    const response = await request(app).get('/events?endDate=not-a-date');
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
    expect(response.body.error).toContain('endDate');
  });

  it('should reject when startDate is after endDate', async () => {
    const response = await request(app).get('/events?startDate=2026-12-31&endDate=2026-01-01');
    expect(response.status).toBe(400);
    expect(response.body.errorName).toBe('ValidationError');
    expect(response.body.error).toContain('startDate');
  });
});
