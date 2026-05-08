import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import express, { Application } from 'express';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventLocation, EventLocationContent, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import { InvalidClientIdError, LocationValidationError, SpaceHijackError } from '@/common/exceptions/calendar';
import CalendarInterface from '@/server/calendar/interface';
import LocationRoutes from '@/server/calendar/api/v1/location';
import ExpressHelper from '@/server/common/helper/express';

describe('Location API Tests', () => {
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
      updateLocation: sandbox.stub(),
      deleteLocation: sandbox.stub(),
      reassignEvents: sandbox.stub(),
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
        'c3d4e5f6-0001-4000-8000-000000000001',
        'Washington Park',
        '4033 SW Canyon Rd',
        'Portland',
        'OR',
        '97221',
      );

      const location2 = new EventLocation(
        'c3d4e5f6-0002-4000-8000-000000000002',
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
      expect(response.body.errorName).toBe('CalendarNotFoundError');
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
        'c3d4e5f6-0001-4000-8000-000000000001',
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
        'c3d4e5f6-0003-4000-8000-000000000003',
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
        'c3d4e5f6-0003-4000-8000-000000000003',
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
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 when user lacks permissions', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send({ name: 'Venue' })
        .expect(403);

      expect(response.body.error).toContain('Insufficient permissions');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 400 when location name is missing', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createLocation as sinon.SinonStub).rejects(
        new LocationValidationError(['Location name is required']),
      );

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send({ address: '123 Main St' })
        .expect(400);

      expect(response.body.error).toBe('Location name is required');
      expect(response.body.errorName).toBe('LocationValidationError');
    });
  });

  describe('GET /api/v1/calendars/:calendarId/locations/:locationId', () => {
    it('should return a specific location', async () => {
      const locationId = 'c3d4e5f6-0001-4000-8000-000000000001';
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
      const locationId = 'c3d4e5f6-0001-4000-8000-000000000001';
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
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 404 when location does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationById as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Location not found');
      expect(response.body.errorName).toBe('LocationNotFoundError');
    });

    it('should return 404 when location belongs to different calendar', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationById as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations/other-calendar-loc')
        .expect(404);

      expect(response.body.error).toBe('Location not found');
      expect(response.body.errorName).toBe('LocationNotFoundError');
    });

    it('should return location with spaces[] populated inline and eventCount per Space', async () => {
      const locationId = 'c3d4e5f6-0001-4000-8000-000000000001';
      const location = new EventLocation(locationId, 'Convention Center');

      const space1 = new EventLocationSpace('space-1', locationId);
      space1.addContent(new EventLocationSpaceContent('en', 'Main Hall'));
      space1.eventCount = 3;
      const space2 = new EventLocationSpace('space-2', locationId);
      space2.addContent(new EventLocationSpaceContent('en', 'Side Room'));
      space2.eventCount = 0;
      location.spaces = [space1, space2];

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationById as sinon.SinonStub).resolves(location);

      const response = await request(app)
        .get(`/api/v1/calendars/cal-123/locations/${encodeURIComponent(locationId)}`)
        .expect(200);

      expect(response.body.spaces).toHaveLength(2);
      expect(response.body.spaces[0].id).toBe('space-1');
      expect(response.body.spaces[0].eventCount).toBe(3);
      expect(response.body.spaces[1].id).toBe('space-2');
      expect(response.body.spaces[1].eventCount).toBe(0);
    });
  });

  describe('PUT /api/v1/calendars/:calendarId/locations/:locationId', () => {
    it('should update a location', async () => {
      const locationId = 'c3d4e5f6-0001-4000-8000-000000000001';
      const updatedLocation = new EventLocation(
        locationId,
        'Updated Venue',
        '789 New St',
        'Portland',
        'OR',
        '97203',
      );

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateLocation as sinon.SinonStub).resolves(updatedLocation);

      const response = await request(app)
        .put(`/api/v1/calendars/cal-123/locations/${encodeURIComponent(locationId)}`)
        .send({ name: 'Updated Venue', address: '789 New St', city: 'Portland', state: 'OR', postalCode: '97203' })
        .expect(200);

      expect(response.body.name).toBe('Updated Venue');
      expect(response.body.address).toBe('789 New St');
    });

    it('should update location with accessibility content', async () => {
      const locationId = 'c3d4e5f6-0001-4000-8000-000000000001';
      const updatedLocation = new EventLocation(
        locationId,
        'Accessible Venue',
        '789 Pine St',
      );
      const content = new EventLocationContent('en', 'Updated accessibility info.');
      updatedLocation.addContent(content);

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateLocation as sinon.SinonStub).resolves(updatedLocation);

      const response = await request(app)
        .put(`/api/v1/calendars/cal-123/locations/${encodeURIComponent(locationId)}`)
        .send({
          name: 'Accessible Venue',
          address: '789 Pine St',
          content: {
            en: { language: 'en', accessibilityInfo: 'Updated accessibility info.' },
          },
        })
        .expect(200);

      expect(response.body.name).toBe('Accessible Venue');
      expect(response.body.content.en.accessibilityInfo).toBe('Updated accessibility info.');
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .put('/api/v1/calendars/nonexistent/locations/loc-1')
        .send({ name: 'Updated' })
        .expect(404);

      expect(response.body.error).toContain('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 when user lacks permissions', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .put('/api/v1/calendars/cal-123/locations/loc-1')
        .send({ name: 'Updated' })
        .expect(403);

      expect(response.body.error).toContain('Insufficient permissions');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 404 when location does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateLocation as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .put('/api/v1/calendars/cal-123/locations/nonexistent')
        .send({ name: 'Updated' })
        .expect(404);

      expect(response.body.error).toBe('Location not found');
      expect(response.body.errorName).toBe('LocationNotFoundError');
    });

    it('should return 400 when location name is empty', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateLocation as sinon.SinonStub).rejects(
        new LocationValidationError(['Location name is required']),
      );

      const response = await request(app)
        .put('/api/v1/calendars/cal-123/locations/loc-1')
        .send({ name: '' })
        .expect(400);

      expect(response.body.error).toBe('Location name is required');
      expect(response.body.errorName).toBe('LocationValidationError');
    });
  });

  describe('DELETE /api/v1/calendars/:calendarId/locations/:locationId', () => {
    it('should delete a location', async () => {
      const locationId = 'c3d4e5f6-0001-4000-8000-000000000001';

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.deleteLocation as sinon.SinonStub).resolves(true);

      await request(app)
        .delete(`/api/v1/calendars/cal-123/locations/${encodeURIComponent(locationId)}`)
        .expect(204);
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .delete('/api/v1/calendars/nonexistent/locations/loc-1')
        .expect(404);

      expect(response.body.error).toContain('Calendar not found');
      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 when user lacks permissions', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .delete('/api/v1/calendars/cal-123/locations/loc-1')
        .expect(403);

      expect(response.body.error).toContain('Insufficient permissions');
      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 404 when location does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.deleteLocation as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .delete('/api/v1/calendars/cal-123/locations/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Location not found');
      expect(response.body.errorName).toBe('LocationNotFoundError');
    });
  });

  describe('GET /api/v1/calendars/:calendarId/locations — spaces eventCount', () => {
    it('should include spaces[] with per-Space eventCount on the list endpoint', async () => {
      const location1 = new EventLocation('loc-1', 'Convention Center');
      const space1 = new EventLocationSpace('space-1', 'loc-1');
      space1.addContent(new EventLocationSpaceContent('en', 'Main Hall'));
      space1.eventCount = 5;
      const space2 = new EventLocationSpace('space-2', 'loc-1');
      space2.addContent(new EventLocationSpaceContent('en', 'Side Room'));
      space2.eventCount = 0;
      location1.spaces = [space1, space2];

      const location2 = new EventLocation('loc-2', 'Studio');
      // location2 has no spaces

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getLocationsForCalendar as sinon.SinonStub).resolves([
        location1,
        location2,
      ]);

      const response = await request(app)
        .get('/api/v1/calendars/cal-123/locations')
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].spaces).toHaveLength(2);
      expect(response.body[0].spaces[0].id).toBe('space-1');
      expect(response.body[0].spaces[0].eventCount).toBe(5);
      expect(response.body[0].spaces[1].id).toBe('space-2');
      expect(response.body[0].spaces[1].eventCount).toBe(0);
      // location2 has empty spaces[] — wire contract is stable
      expect(response.body[1].spaces).toEqual([]);
    });
  });

  describe('POST/PUT spaces[] error mapping', () => {
    it('POST returns 400 with errorName SpaceHijackError', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createLocation as sinon.SinonStub).rejects(
        new SpaceHijackError('space-from-other-place', 'loc-1'),
      );

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send({ name: 'V', spaces: [{ id: 'space-from-other-place' }] })
        .expect(400);

      expect(response.body.errorName).toBe('SpaceHijackError');
      expect(response.body.error).toContain('space-from-other-place');
    });

    it('POST returns 400 with errorName InvalidClientIdError', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createLocation as sinon.SinonStub).rejects(
        new InvalidClientIdError('not-a-uuid'),
      );

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send({ name: 'V', spaces: [{ clientId: 'not-a-uuid' }] })
        .expect(400);

      expect(response.body.errorName).toBe('InvalidClientIdError');
    });

    it('PUT returns 400 with errorName SpaceHijackError', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateLocation as sinon.SinonStub).rejects(
        new SpaceHijackError('hijack-id', 'loc-1'),
      );

      const response = await request(app)
        .put('/api/v1/calendars/cal-123/locations/loc-1')
        .send({ name: 'V', spaces: [{ id: 'hijack-id' }] })
        .expect(400);

      expect(response.body.errorName).toBe('SpaceHijackError');
    });

    it('PUT returns 400 with errorName InvalidClientIdError', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateLocation as sinon.SinonStub).rejects(
        new InvalidClientIdError('not-a-uuid'),
      );

      const response = await request(app)
        .put('/api/v1/calendars/cal-123/locations/loc-1')
        .send({ name: 'V', spaces: [{ clientId: 'not-a-uuid' }] })
        .expect(400);

      expect(response.body.errorName).toBe('InvalidClientIdError');
    });
  });

  describe('POST/PUT serialize spaces[] with eventCount', () => {
    it('POST 201 response includes spaces[] with per-Space eventCount', async () => {
      const created = new EventLocation('loc-new', 'New Venue');
      const space = new EventLocationSpace('space-new', 'loc-new');
      space.addContent(new EventLocationSpaceContent('en', 'Main Hall'));
      space.eventCount = 0;
      created.spaces = [space];

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createLocation as sinon.SinonStub).resolves(created);

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations')
        .send({ name: 'New Venue', spaces: [{ content: { en: { name: 'Main Hall' } } }] })
        .expect(201);

      expect(response.body.spaces).toHaveLength(1);
      expect(response.body.spaces[0].id).toBe('space-new');
      expect(response.body.spaces[0].eventCount).toBe(0);
    });

    it('PUT 200 response includes spaces[] with per-Space eventCount', async () => {
      const updated = new EventLocation('loc-1', 'Updated');
      const space = new EventLocationSpace('space-1', 'loc-1');
      space.addContent(new EventLocationSpaceContent('en', 'Main Hall'));
      space.eventCount = 7;
      updated.spaces = [space];

      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateLocation as sinon.SinonStub).resolves(updated);

      const response = await request(app)
        .put('/api/v1/calendars/cal-123/locations/loc-1')
        .send({ name: 'Updated', spaces: [{ id: 'space-1', content: { en: { name: 'Main Hall' } } }] })
        .expect(200);

      expect(response.body.spaces).toHaveLength(1);
      expect(response.body.spaces[0].id).toBe('space-1');
      expect(response.body.spaces[0].eventCount).toBe(7);
    });
  });

  describe('POST /api/v1/calendars/:calendarId/locations/:locationId/reassign-events', () => {
    const fromSpaceId = '11111111-1111-4111-8111-111111111111';
    const toSpaceId = '22222222-2222-4222-8222-222222222222';

    it('returns 200 { count } on success', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.reassignEvents as sinon.SinonStub).resolves({
        count: 4,
        placeFound: true,
        toSpaceValid: true,
      });

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-1/reassign-events')
        .send({ fromSpaceId, toSpaceId })
        .expect(200);

      expect(response.body).toEqual({ count: 4 });
    });

    it('returns 200 { count: 0 } when fromSpaceId is out-of-Place (idempotent no-op)', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      // The service-layer UPDATE simply matches zero rows.
      (calendarInterface.reassignEvents as sinon.SinonStub).resolves({
        count: 0,
        placeFound: true,
        toSpaceValid: true,
      });

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-1/reassign-events')
        .send({ fromSpaceId, toSpaceId })
        .expect(200);

      expect(response.body).toEqual({ count: 0 });
    });

    it('returns 400 when fromSpaceId is malformed (non-UUID)', async () => {
      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-1/reassign-events')
        .send({ fromSpaceId: 'not-a-uuid', toSpaceId })
        .expect(400);

      expect(response.body.errorName).toBe('ValidationError');
      // No service call should happen on validation failure
      expect((calendarInterface.reassignEvents as sinon.SinonStub).called).toBe(false);
    });

    it('returns 400 when fromSpaceId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-1/reassign-events')
        .send({ toSpaceId })
        .expect(400);

      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 400 when toSpaceId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-1/reassign-events')
        .send({ fromSpaceId })
        .expect(400);

      expect(response.body.errorName).toBe('ValidationError');
    });

    it('returns 400 when toSpaceId is not on this Place', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.reassignEvents as sinon.SinonStub).resolves({
        count: 0,
        placeFound: true,
        toSpaceValid: false,
      });

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-1/reassign-events')
        .send({ fromSpaceId, toSpaceId })
        .expect(400);

      expect(response.body.errorName).toBe('ValidationError');
      expect(response.body.error).toContain('toSpaceId');
    });

    it('returns 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .post('/api/v1/calendars/nonexistent/locations/loc-1/reassign-events')
        .send({ fromSpaceId, toSpaceId })
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('returns 404 when location is not on this calendar', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.reassignEvents as sinon.SinonStub).resolves({
        count: 0,
        placeFound: false,
        toSpaceValid: false,
      });

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-other-calendar/reassign-events')
        .send({ fromSpaceId, toSpaceId })
        .expect(404);

      expect(response.body.errorName).toBe('LocationNotFoundError');
    });

    it('returns 403 when user lacks calendar edit permissions', async () => {
      (calendarInterface.getCalendar as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .post('/api/v1/calendars/cal-123/locations/loc-1/reassign-events')
        .send({ fromSpaceId, toSpaceId })
        .expect(403);

      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
      // Auth check fails before the service call
      expect((calendarInterface.reassignEvents as sinon.SinonStub).called).toBe(false);
    });
  });
});
