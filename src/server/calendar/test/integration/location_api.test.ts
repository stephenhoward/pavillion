import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import express, { Application } from 'express';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent } from '@/common/model/location';
import CalendarInterface from '@/server/calendar/interface';
import LocationRoutes from '@/server/calendar/api/v1/location';
import ExpressHelper from '@/server/common/helper/express';

describe('Location API Integration Tests', () => {
  let app: Application;
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: CalendarInterface;
  let locationRoutes: LocationRoutes;

  const testAccount = new Account('account-123', 'test@example.com');
  const testCalendar = new Calendar('cal-123', 'testcalendar');

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    app = express();
    app.use(express.json());

    // Stub ExpressHelper.loggedInOnly to inject test account
    // ExpressHelper.loggedInOnly is an array of middleware, so we need to replace it with an array
    sandbox.stub(ExpressHelper, 'loggedInOnly').value([
      (req: Request, res: Response, next: () => void) => {
        req.user = testAccount;
        next();
      },
    ]);

    // Create stub for CalendarInterface
    calendarInterface = {
      getCalendar: sandbox.stub(),
      userCanModifyCalendar: sandbox.stub(),
      getLocationsForCalendar: sandbox.stub(),
      getLocationById: sandbox.stub(),
      createLocation: sandbox.stub(),
    } as unknown as CalendarInterface;

    locationRoutes = new LocationRoutes(calendarInterface);
    locationRoutes.installHandlers(app, '/api/v1');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('GET /api/v1/calendars/:calendarId/locations', () => {
    it('should return all locations for a calendar', async () => {
      const location1 = new EventLocation(
        'https://pavillion.dev/places/loc-1',
        'Washington Park',
        '4033 SW Canyon Rd',
        'Portland',
        'OR',
        '97221',
      );

      const location2 = new EventLocation(
        'https://pavillion.dev/places/loc-2',
        'Community Center',
        '123 Main St',
        'Portland',
        'OR',
        '97201',
      );

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationsForCalendar as sinon.SinonStub).resolves([
        location1,
        location2,
      ]);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].name).toBe('Washington Park');
      expect(response.body[1].name).toBe('Community Center');
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/nonexistent/locations')
        .expect(404);

      expect(response.body.error).toContain('Calendar not found');
    });

    it('should return empty array when calendar has no locations', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationsForCalendar as sinon.SinonStub).resolves([]);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations')
        .expect(200);

      expect(response.body).toHaveLength(0);
    });

    it('should include location content in response', async () => {
      const location = new EventLocation(
        'https://pavillion.dev/places/loc-1',
        'Community Center',
        '123 Main St',
      );
      const content = new EventLocationContent('en', 'Wheelchair accessible.');
      location.addContent(content);

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationsForCalendar as sinon.SinonStub).resolves([location]);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].content).toBeDefined();
      expect(response.body[0].content.en).toBeDefined();
      expect(response.body[0].content.en.accessibilityInfo).toBe('Wheelchair accessible.');
    });
  });

  describe('POST /api/v1/calendars/:calendarId/locations', () => {
    it('should create a new location', async () => {
      const locationData = {
        name: 'New Venue',
        address: '456 Oak St',
        city: 'Portland',
        state: 'OR',
        postalCode: '97202',
      };

      const createdLocation = new EventLocation(
        'https://pavillion.dev/places/new-loc',
        'New Venue',
        '456 Oak St',
        'Portland',
        'OR',
        '97202',
      );

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createLocation as sinon.SinonStub).resolves(createdLocation);

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send(locationData)
        .expect(201);
      expect(response.body.name).toBe('New Venue');
      expect(response.body.id).toBeDefined();
      expect(response.body.address).toBe('456 Oak St');
    });

    it('should create location with accessibility content', async () => {
      const locationData = {
        name: 'Accessible Venue',
        address: '789 Pine St',
        content: {
          en: {
            language: 'en',
            accessibilityInfo: 'Elevator access to all floors.',
          },
        },
      };

      const createdLocation = new EventLocation(
        'https://pavillion.dev/places/new-loc',
        'Accessible Venue',
        '789 Pine St',
      );
      const content = new EventLocationContent('en', 'Elevator access to all floors.');
      createdLocation.addContent(content);

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createLocation as sinon.SinonStub).resolves(createdLocation);

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send(locationData)
        .expect(201);

      expect(response.body.name).toBe('Accessible Venue');
      expect(response.body.content.en.accessibilityInfo).toBe('Elevator access to all floors.');
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .post('/api/v1/calendars/nonexistent/locations')
        .send({ name: 'Venue' })
        .expect(404);

      expect(response.body.error).toContain('Calendar not found');
    });

    it('should return 403 when user lacks permissions', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send({ name: 'Venue' })
        .expect(403);

      expect(response.body.error).toContain('Insufficient permissions');
    });

    it('should return 400 when location name is missing', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createLocation as sinon.SinonStub).rejects(
        new Error('Location name is required'),
      );

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send({ address: '123 Main St' })
        .expect(400);

      expect(response.body.error).toBe('Location name is required');
    });
  });

  describe('GET /api/v1/calendars/:calendarId/locations/:locationId', () => {
    it('should return a specific location', async () => {
      const locationId = 'https://pavillion.dev/places/loc-1';
      const location = new EventLocation(
        locationId,
        'Washington Park',
        '4033 SW Canyon Rd',
        'Portland',
        'OR',
        '97221',
      );

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationById as sinon.SinonStub).resolves(location);

      const response = await request(app)
        .get(`/api/v1/calendars/cal-123/locations/${encodeURIComponent(locationId)}`)
        .expect(200);

      expect(response.body.name).toBe('Washington Park');
      expect(response.body.address).toBe('4033 SW Canyon Rd');
    });

    it('should return location with content', async () => {
      const locationId = 'https://pavillion.dev/places/loc-1';
      const location = new EventLocation(
        locationId,
        'Community Center',
        '123 Main St',
      );
      const enContent = new EventLocationContent('en', 'Wheelchair ramps available.');
      const esContent = new EventLocationContent('es', 'Rampas disponibles.');
      location.addContent(enContent);
      location.addContent(esContent);

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationById as sinon.SinonStub).resolves(location);

      const response = await request(app)
        .get(`/api/v1/calendars/cal-123/locations/${encodeURIComponent(locationId)}`)
        .expect(200);

      expect(response.body.content.en.accessibilityInfo).toBe('Wheelchair ramps available.');
      expect(response.body.content.es.accessibilityInfo).toBe('Rampas disponibles.');
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/nonexistent/locations/loc-1')
        .expect(404);

      expect(response.body.error).toContain('Calendar not found');
    });

    it('should return 404 when location does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationById as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Location not found');
    });

    it('should return 404 when location belongs to different calendar', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationById as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations/other-calendar-loc')
        .expect(404);

      expect(response.body.error).toBe('Location not found');
    });
  });
});
