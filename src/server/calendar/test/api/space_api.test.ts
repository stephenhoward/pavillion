import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import sinon from 'sinon';
import express, { Application } from 'express';

import { Account } from '@/common/model/account';
import { Calendar } from '@/common/model/calendar';
import { EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import { LocationNotFoundError } from '@/common/exceptions/calendar';
import CalendarInterface from '@/server/calendar/interface';
import SpaceRoutes from '@/server/calendar/api/v1/space';
import ExpressHelper from '@/server/common/helper/express';

describe('Space API Tests', () => {
  let app: Application;
  let sandbox: sinon.SinonSandbox;
  let calendarInterface: CalendarInterface;
  let spaceRoutes: SpaceRoutes;

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
      getCalendarByName: sandbox.stub(),
      userCanModifyCalendar: sandbox.stub(),
      getSpacesForPlace: sandbox.stub(),
      getSpaceById: sandbox.stub(),
      createSpace: sandbox.stub(),
      updateSpace: sandbox.stub(),
      deleteSpace: sandbox.stub(),
    } as unknown as CalendarInterface;

    spaceRoutes = new SpaceRoutes(calendarInterface);
    spaceRoutes.installHandlers(app, '/api/v1');
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('POST /api/v1/calendars/:urlname/places/:placeId/spaces', () => {
    it('should create a new space and return 201', async () => {
      const placeId = 'place-1111-1111-1111-111111111111';
      const spaceId = 'space-1111-1111-1111-11111111111';
      const createdSpace = new EventLocationSpace(spaceId, placeId);
      createdSpace.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));

      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createSpace as sinon.SinonStub).resolves(createdSpace);

      const response = await request(app)
        .post(`/api/v1/calendars/testcalendar/places/${placeId}/spaces`)
        .send({
          content: {
            en: { language: 'en', name: 'Pacific Room', accessibilityInfo: 'Hearing loop' },
          },
        })
        .expect(201);

      expect(response.body.id).toBe(spaceId);
      expect(response.body.placeId).toBe(placeId);
      expect(response.body.content.en.name).toBe('Pacific Room');
      expect(response.body.content.en.accessibilityInfo).toBe('Hearing loop');
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .post('/api/v1/calendars/missingcal/places/place-1/spaces')
        .send({ content: { en: { language: 'en', name: 'X', accessibilityInfo: '' } } })
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 when user lacks permissions', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .post('/api/v1/calendars/testcalendar/places/place-1/spaces')
        .send({ content: { en: { language: 'en', name: 'X', accessibilityInfo: '' } } })
        .expect(403);

      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 404 when Place does not exist or is not owned by calendar', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.createSpace as sinon.SinonStub).rejects(
        new LocationNotFoundError('Place not found or not owned by calendar'),
      );

      const response = await request(app)
        .post('/api/v1/calendars/testcalendar/places/missing-place/spaces')
        .send({ content: { en: { language: 'en', name: 'X', accessibilityInfo: '' } } })
        .expect(404);

      expect(response.body.errorName).toBe('LocationNotFoundError');
    });
  });

  describe('GET /api/v1/calendars/:urlname/places/:placeId/spaces', () => {
    it('should return all spaces for a place', async () => {
      const placeId = 'place-1';
      const space1 = new EventLocationSpace('space-1', placeId);
      space1.addContent(new EventLocationSpaceContent('en', 'Room A', ''));
      const space2 = new EventLocationSpace('space-2', placeId);
      space2.addContent(new EventLocationSpaceContent('en', 'Room B', ''));

      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getSpacesForPlace as sinon.SinonStub).resolves([space1, space2]);

      const response = await request(app)
        .get(`/api/v1/calendars/testcalendar/places/${placeId}/spaces`)
        .expect(200);

      expect(response.body).toHaveLength(2);
      expect(response.body[0].id).toBe('space-1');
      expect(response.body[0].content.en.name).toBe('Room A');
      expect(response.body[1].id).toBe('space-2');
      expect(response.body[1].content.en.name).toBe('Room B');
    });

    it('should return empty array when place has no spaces', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getSpacesForPlace as sinon.SinonStub).resolves([]);

      const response = await request(app)
        .get('/api/v1/calendars/testcalendar/places/place-1/spaces')
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/missingcal/places/place-1/spaces')
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });
  });

  describe('GET /api/v1/calendars/:urlname/spaces/:spaceId', () => {
    it('should return a specific space', async () => {
      const spaceId = 'space-1';
      const space = new EventLocationSpace(spaceId, 'place-1');
      space.addContent(new EventLocationSpaceContent('en', 'Pacific Room', 'Hearing loop'));

      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getSpaceById as sinon.SinonStub).resolves(space);

      const response = await request(app)
        .get(`/api/v1/calendars/testcalendar/spaces/${spaceId}`)
        .expect(200);

      expect(response.body.id).toBe(spaceId);
      expect(response.body.content.en.name).toBe('Pacific Room');
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/missingcal/spaces/space-1')
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 404 when space does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.getSpaceById as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .get('/api/v1/calendars/testcalendar/spaces/missing-space')
        .expect(404);

      expect(response.body.errorName).toBe('LocationNotFoundError');
    });
  });

  describe('PUT /api/v1/calendars/:urlname/spaces/:spaceId', () => {
    it('should update a space', async () => {
      const spaceId = 'space-1';
      const updatedSpace = new EventLocationSpace(spaceId, 'place-1');
      updatedSpace.addContent(new EventLocationSpaceContent('en', 'Updated Room', 'Updated info'));

      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateSpace as sinon.SinonStub).resolves(updatedSpace);

      const response = await request(app)
        .put(`/api/v1/calendars/testcalendar/spaces/${spaceId}`)
        .send({
          content: {
            en: { language: 'en', name: 'Updated Room', accessibilityInfo: 'Updated info' },
          },
        })
        .expect(200);

      expect(response.body.id).toBe(spaceId);
      expect(response.body.content.en.name).toBe('Updated Room');
      expect(response.body.content.en.accessibilityInfo).toBe('Updated info');
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .put('/api/v1/calendars/missingcal/spaces/space-1')
        .send({ content: { en: { language: 'en', name: 'X', accessibilityInfo: '' } } })
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 when user lacks permissions', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .put('/api/v1/calendars/testcalendar/spaces/space-1')
        .send({ content: { en: { language: 'en', name: 'X', accessibilityInfo: '' } } })
        .expect(403);

      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 404 when space does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.updateSpace as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .put('/api/v1/calendars/testcalendar/spaces/missing-space')
        .send({ content: { en: { language: 'en', name: 'X', accessibilityInfo: '' } } })
        .expect(404);

      expect(response.body.errorName).toBe('LocationNotFoundError');
    });
  });

  describe('DELETE /api/v1/calendars/:urlname/spaces/:spaceId', () => {
    it('should delete a space and return 204', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.deleteSpace as sinon.SinonStub).resolves(true);

      await request(app)
        .delete('/api/v1/calendars/testcalendar/spaces/space-1')
        .expect(204);
    });

    it('should return 404 when calendar does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(null);

      const response = await request(app)
        .delete('/api/v1/calendars/missingcal/spaces/space-1')
        .expect(404);

      expect(response.body.errorName).toBe('CalendarNotFoundError');
    });

    it('should return 403 when user lacks permissions', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .delete('/api/v1/calendars/testcalendar/spaces/space-1')
        .expect(403);

      expect(response.body.errorName).toBe('InsufficientCalendarPermissionsError');
    });

    it('should return 404 when space does not exist', async () => {
      (calendarInterface.getCalendarByName as sinon.SinonStub).resolves(testCalendar);
      (calendarInterface.userCanModifyCalendar as sinon.SinonStub).resolves(true);
      (calendarInterface.deleteSpace as sinon.SinonStub).resolves(false);

      const response = await request(app)
        .delete('/api/v1/calendars/testcalendar/spaces/missing-space')
        .expect(404);

      expect(response.body.errorName).toBe('LocationNotFoundError');
    });
  });
});
